//! Routing ingress dan adapter format pengirim ke kontrak internal GUI.

use serde::Deserialize;

use super::protocol::{validasi_pesan, Pesan, VisemeItem};

/// Topik yang benar-benar dipakai `brone-talk` (lihat laporan audit 11 Nov 2026).
pub const TOPIC_LLM_EKSPRESI: &str = "robot/expression";
pub const TOPIC_LLM_WORD: &str = "robot/word";
pub const TOPIC_LLM_SENTENCE: &str = "robot/sentence";
pub const TOPIC_LLM_VOICE_STAGE: &str = "robot/voice_stage";
pub const TOPIC_CV_GAZE: &str = "robot/gaze";

/// Topik bawaan backend; bootstrap tidak menulis ulang daftar ini.
pub const DEFAULT_TOPICS: &[&str] = &[
    TOPIC_LLM_EKSPRESI,
    TOPIC_LLM_VOICE_STAGE,
    TOPIC_LLM_WORD,
    TOPIC_LLM_SENTENCE,
    TOPIC_CV_GAZE,
    "brone/face/ekspresi",
    "brone/face/viseme",
    "brone/face/bicara",
];

/// Memilih adapter berdasarkan topik, tanpa mengubah penerimaan pesan lama.
/// Validasi hasil tetap per pesan di transport agar paket gabungan tidak menjadi atomik.
pub fn parse_pesan(topic: &str, payload: &str) -> Result<Vec<Pesan>, String> {
    match topic {
        TOPIC_CV_GAZE => {
            let GazePayload::Gaze { x } = serde_json::from_str(payload)
                .map_err(|e| format!("JSON gaze tidak valid: {e}"))?;
            let pesan = Pesan::Gaze { x };
            validasi_pesan(&pesan).map_err(str::to_string)?;
            Ok(vec![pesan])
        }
        TOPIC_LLM_EKSPRESI | TOPIC_LLM_VOICE_STAGE | TOPIC_LLM_WORD | TOPIC_LLM_SENTENCE => {
            pesan_dari_llm(topic, payload)
        }
        // Pertahankan error untuk topik robot yang belum didukung.
        _ if topic.starts_with("robot/") => Err(format!("Topik LLM tidak dikenal: {topic}")),
        // Kompatibilitas: pesan internal tetap ditentukan oleh payload, bukan nama topik.
        _ => serde_json::from_str::<Pesan>(payload)
            .map(|p| vec![p])
            .map_err(|e| format!("JSON tidak sesuai kontrak GUI: {e}")),
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum GazePayload {
    #[serde(rename = "gaze")]
    Gaze { x: f64 },
}

#[derive(Deserialize)]
struct LlmExpression {
    #[serde(default)]
    expression: Option<String>,
    #[serde(default)]
    emosi: Option<String>,
    /// Alias Indonesia penuh untuk "expression"
    #[serde(default)]
    ekspresi: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    durasi_s: Option<f64>,
    #[serde(default)]
    viseme: Option<Vec<VisemeItem>>,
    #[serde(default)]
    jadwal: Option<Vec<VisemeItem>>,
}

#[derive(Deserialize)]
struct LlmVoiceStage {
    stage: String,
    #[serde(default)]
    state: String,
}

/// Memetakan nama ekspresi LLM ke nama kanonik GUI (tabel audit bagian 4).
fn petakan_emosi(nama: &str) -> Option<&'static str> {
    match nama.to_ascii_lowercase().as_str() {
        "idle" | "netral" | "neutral" => Some("idle"),
        "happy" | "senang" => Some("happy"),
        "happier" | "sangat_senang" => Some("happier"),
        "happier_transisi" | "sangat_senang_transisi" => Some("happier_transisi"),
        "sad" | "sedih" => Some("sad"),
        "cry" | "menangis" => Some("cry"),
        "shock" | "terkejut" => Some("shock"),
        "confused" | "thinking" | "berpikir" => Some("confused"),
        "timeout" => Some("timeout"),
        "excited" => Some("happier"),
        _ => None,
    }
}

fn ekspresi(emosi: &str) -> Pesan {
    Pesan::Ekspresi {
        id: String::new(),
        emosi: emosi.into(),
        intensitas: 1.0,
        durasi_ms: None,
    }
}

/// Menerjemahkan payload mentah `robot/#` dari LLM ke kontrak internal GUI.
/// Mendukung payload tunggal maupun gabungan (ekspresi + durasi + viseme jadwal).
pub fn pesan_dari_llm(topic: &str, payload: &str) -> Result<Vec<Pesan>, String> {
    // Keep each sentence and its face state together instead of emitting a new
    // expression immediately, which would interrupt the sentence already playing.
    let combined = topic == TOPIC_LLM_EKSPRESI
        && serde_json::from_str::<serde_json::Value>(payload)
            .is_ok_and(|value| value.get("sentence").is_some());
    if topic == TOPIC_LLM_SENTENCE || combined {
        #[derive(Deserialize)]
        struct SentencePayload { expression: String, duration: f64, sentence: String }
        let raw: SentencePayload = serde_json::from_str(payload)
            .map_err(|e| format!("JSON sentence tidak valid: {e}"))?;
        let expression = petakan_emosi(&raw.expression)
            .ok_or_else(|| format!("Ekspresi LLM tidak dikenal: {}", raw.expression))?;
        let message = Pesan::Sentence {
            expression: expression.into(), duration: raw.duration, sentence: raw.sentence,
        };
        validasi_pesan(&message).map_err(str::to_string)?;
        return Ok(vec![message]);
    }
    if topic == TOPIC_LLM_WORD {
        #[derive(Deserialize)]
        struct WordPayload { word: String }
        let raw: WordPayload = serde_json::from_str(payload)
            .map_err(|e| format!("JSON word tidak valid: {e}"))?;
        let message = Pesan::Word { word: raw.word };
        validasi_pesan(&message).map_err(str::to_string)?;
        return Ok(vec![message]);
    }
    else if topic == TOPIC_LLM_EKSPRESI {
        let raw: LlmExpression = serde_json::from_str(payload)
            .map_err(|e| format!("JSON ekspresi LLM tidak valid: {e}"))?;

        let raw_expr = raw.expression.or(raw.emosi).or(raw.ekspresi);
        let duration = raw.duration.or(raw.durasi_s);
        if duration.is_some_and(|d| !d.is_finite() || d <= 0.0 || d > 3600.0) {
            return Err("Durasi harus positif dan paling lama 3600 detik".into());
        }
        let visemes = raw.viseme.or(raw.jadwal);

        let mut pesan_list = Vec::new();

        if let Some(expr_str) = raw_expr {
            if expr_str.eq_ignore_ascii_case("speaking") {
                // Skenario 1: Penanda mulai bicara format lama
                pesan_list.push(Pesan::Bicara {
                    status: "mulai".into(),
                    durasi_s: duration.map(|d| d as f32),
                });
            } else if let Some(emosi) = petakan_emosi(&expr_str) {
                // Skenario 2: Emosi asli (happy, sad, idle, dsb)
                let durasi_ms = duration
                    .map(|detik| (detik.max(0.0) * 1000.0) as u32)
                    .filter(|ms| *ms > 0);

                pesan_list.push(Pesan::Ekspresi {
                    id: String::new(),
                    emosi: emosi.into(),
                    intensitas: 1.0,
                    durasi_ms,
                });

                // Jika membawa durasi suara, emit juga bicara mulai
                if let Some(d) = duration {
                    pesan_list.push(Pesan::Bicara {
                        status: "mulai".into(),
                        durasi_s: Some(d as f32),
                    });
                }
            } else {
                return Err(format!("Ekspresi LLM tidak dikenal: {}", expr_str));
            }
        }

        // Jika membawa jadwal viseme (paket gabungan cerdas)
        if let Some(v_list) = visemes {
            if !v_list.is_empty() {
                pesan_list.push(Pesan::Viseme {
                    id: String::new(),
                    jadwal: v_list,
                });
            }
        }

        Ok(pesan_list)
    } else if topic == TOPIC_LLM_VOICE_STAGE {
        let raw: LlmVoiceStage = serde_json::from_str(payload)
            .map_err(|e| format!("JSON voice_stage LLM tidak valid: {e}"))?;
        let stage = raw.stage.to_ascii_lowercase();
        let state = raw.state.to_ascii_lowercase();

        if stage == "error" || state == "error" {
            return Ok(vec![ekspresi("timeout")]);
        }
        match (stage.as_str(), state.as_str()) {
            ("llm", "start") => Ok(vec![ekspresi("confused")]),
            ("tts", "start") => Ok(vec![Pesan::Bicara {
                status: "mulai".into(),
                durasi_s: None,
            }]),
            ("tts", "end" | "done" | "finish" | "finished" | "stop" | "selesai") => Ok(vec![Pesan::Bicara {
                status: "selesai".into(),
                durasi_s: None,
            }]),
            ("idle", "standby") => Ok(vec![ekspresi("idle")]),
            _ => Ok(vec![]),
        }
    } else {
        Err(format!("Topik LLM tidak dikenal: {topic}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gaze_contract() {
        for x in [-f64::MAX, -5.0, -1.0, -0.5, 0.0, 0.5, 1.0, 8.0, f64::MAX] {
            let payload = serde_json::json!({"type": "gaze", "x": x}).to_string();
            let pesan = parse_pesan(TOPIC_CV_GAZE, &payload).unwrap();
            assert_eq!(pesan, vec![Pesan::Gaze { x }]);
            assert_eq!(pesan[0].event_name(), "brone://gaze");
            assert_eq!(serde_json::to_value(&pesan[0]).unwrap(),
                serde_json::json!({"tipe": "gaze", "x": x}));
        }
        for payload in [
            "not json", "null", "[]", "{}",
            r#"["gaze",0]"#,
            r#"{"type":"gaze"}"#, r#"{"x":0}"#,
            r#"{"type":"other","x":0}"#,
            r#"{"type":"gaze","x":"0.5"}"#,
            r#"{"type":"gaze","x":null}"#,
            r#"{"type":"gaze","x":true}"#,
            r#"{"type":"gaze","x":0,"y":0}"#,
            r#"{"type":"gaze","x":0,"x":1}"#,
        ] {
            assert!(parse_pesan(TOPIC_CV_GAZE, payload).is_err(), "{payload}");
        }
        for x in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(validasi_pesan(&Pesan::Gaze { x }).is_err());
        }
    }

    #[test]
    fn test_routing_preserves_combined_event_order_and_payload() {
        let pesan = parse_pesan(
            TOPIC_LLM_EKSPRESI,
            r#"{"expression":"happy","duration":2.5,"viseme":[{"t":0.0,"v":"REST"},{"t":0.5,"v":"A"}]}"#,
        ).unwrap();

        let events: Vec<_> = pesan.iter().map(|p| {
            validasi_pesan(p).unwrap();
            (p.event_name(), serde_json::to_value(p).unwrap())
        }).collect();

        assert_eq!(events, vec![
            ("brone://ekspresi", serde_json::json!({
                "tipe": "ekspresi", "id": "", "emosi": "happy",
                "intensitas": 1.0, "durasi_ms": 2500,
            })),
            ("brone://bicara", serde_json::json!({
                "tipe": "bicara", "status": "mulai", "durasi_s": 2.5,
            })),
            ("brone://viseme", serde_json::json!({
                "tipe": "viseme", "id": "",
                "jadwal": [{"t": 0.0, "v": "REST"}, {"t": 0.5, "v": "A"}],
            })),
        ]);
    }

    #[test]
    fn test_invalid_viseme_does_not_cancel_expression_or_speech() {
        let pesan = parse_pesan(
            TOPIC_LLM_EKSPRESI,
            r#"{"expression":"happy","duration":2,"viseme":[{"t":0,"v":"INVALID"}]}"#,
        ).unwrap();

        assert_eq!(pesan.len(), 3);
        // MQTT tetap melewati hanya pesan invalid, bukan menolak seluruh paket.
        let events: Vec<_> = pesan.iter()
            .filter(|p| validasi_pesan(p).is_ok())
            .map(Pesan::event_name)
            .collect();
        assert_eq!(events, vec!["brone://ekspresi", "brone://bicara"]);
    }

    #[test]
    fn test_manual_routing_keeps_payload_based_compatibility() {
        let payload = r#"{"tipe":"bicara","status":"selesai"}"#;
        // Jalur lama tidak membatasi jenis pesan berdasarkan nama topik manual.
        for topic in ["brone/face/bicara", "brone/face/ekspresi", "manual/custom"] {
            let pesan = parse_pesan(topic, payload).unwrap();
            assert_eq!(pesan.len(), 1);
            validasi_pesan(&pesan[0]).unwrap();
            assert_eq!(pesan[0].event_name(), "brone://bicara");
            assert_eq!(serde_json::to_value(&pesan[0]).unwrap(),
                serde_json::json!({"tipe": "bicara", "status": "selesai"}));
        }
    }

    #[test]
    fn test_routing_preserves_word_and_ignored_voice_stage() {
        let pesan = parse_pesan(TOPIC_LLM_WORD, r#"{"word":"belum"}"#).unwrap();
        assert_eq!(pesan[0].event_name(), "brone://word");
        assert_eq!(serde_json::to_value(&pesan[0]).unwrap(),
            serde_json::json!({"tipe": "word", "word": "belum"}));
        assert!(parse_pesan(TOPIC_LLM_WORD, r#"{"word":""}"#).is_err());
        assert!(parse_pesan(TOPIC_LLM_VOICE_STAGE,
            r#"{"stage":"tts","state":"progress"}"#).unwrap().is_empty());
        assert_eq!(parse_pesan("robot/unknown", "{}").unwrap_err(),
            "Topik LLM tidak dikenal: robot/unknown");
        assert!(parse_pesan("brone/face/ekspresi", "not json").is_err());
    }

    #[test]
    fn test_adapter_ekspresi_llm() {
        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"neutral"}"#)
            .unwrap();
        assert_eq!(p, vec![ekspresi("idle")]);

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"excited"}"#)
            .unwrap();
        assert_eq!(p, vec![ekspresi("happier")]);

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"confused"}"#)
            .unwrap();
        assert_eq!(p, vec![ekspresi("confused")]);

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"speaking","duration":4}"#)
            .unwrap();
        assert_eq!(p, vec![Pesan::Bicara { status: "mulai".into(), durasi_s: Some(4.0) }]);

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"happy","duration":2.5}"#)
            .unwrap();
        assert_eq!(
            p,
            vec![
                Pesan::Ekspresi {
                    id: String::new(),
                    emosi: "happy".into(),
                    intensitas: 1.0,
                    durasi_ms: Some(2500),
                },
                Pesan::Bicara {
                    status: "mulai".into(),
                    durasi_s: Some(2.5),
                }
            ]
        );

        // Paket gabungan ekspresi + viseme
        let p = pesan_dari_llm(
            TOPIC_LLM_EKSPRESI,
            r#"{"expression":"happy","duration":2.0,"viseme":[{"t":0.0,"v":"REST"},{"t":0.1,"v":"A"}]}"#,
        ).unwrap();
        assert_eq!(
            p,
            vec![
                Pesan::Ekspresi {
                    id: String::new(),
                    emosi: "happy".into(),
                    intensitas: 1.0,
                    durasi_ms: Some(2000),
                },
                Pesan::Bicara {
                    status: "mulai".into(),
                    durasi_s: Some(2.0),
                },
                Pesan::Viseme {
                    id: String::new(),
                    jadwal: vec![
                        VisemeItem { t: 0.0, v: "REST".into() },
                        VisemeItem { t: 0.1, v: "A".into() },
                    ],
                }
            ]
        );

        assert!(pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"marah"}"#).is_err());
    }

    #[test]
    fn test_adapter_voice_stage_llm() {
        let p = pesan_dari_llm(
            TOPIC_LLM_VOICE_STAGE,
            r#"{"stage":"llm","state":"start","ts":1.0}"#,
        )
        .unwrap();
        assert_eq!(p, vec![ekspresi("confused")]);

        let p = pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"error","state":"llm"}"#)
            .unwrap();
        assert_eq!(p, vec![ekspresi("timeout")]);

        let p = pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"tts","state":"start"}"#)
            .unwrap();
        assert_eq!(p, vec![Pesan::Bicara { status: "mulai".into(), durasi_s: None }]);

        let p = pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"tts","state":"end"}"#)
            .unwrap();
        assert_eq!(p, vec![Pesan::Bicara { status: "selesai".into(), durasi_s: None }]);

        assert!(pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"vad","state":"start"}"#)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn test_sentence_stream_contract() {
        let payload = r#"{"expression":"happy","duration":3.5,"sentence":"Halo, apa kabar?"}"#;
        let expected = vec![Pesan::Sentence {
            expression: "happy".into(), duration: 3.5, sentence: "Halo, apa kabar?".into(),
        }];
        for topic in [TOPIC_LLM_EKSPRESI, TOPIC_LLM_SENTENCE] {
            let messages = parse_pesan(topic, payload).unwrap();
            // One event, so queued face state cannot interrupt the active sentence.
            assert_eq!(messages, expected);
            assert_eq!(messages[0].event_name(), "brone://sentence");
            let internal = serde_json::json!({"tipe":"sentence", "expression":"happy", "duration":3.5, "sentence":"Halo, apa kabar?"});
            assert_eq!(serde_json::to_value(&messages[0]).unwrap(), internal);
            assert_eq!(parse_pesan("brone/face/sentence", &internal.to_string()).unwrap(), messages);
            for patch in [
                serde_json::json!({"expression":"speaking"}), serde_json::json!({"expression":"unknown"}),
                serde_json::json!({"expression":null}), serde_json::json!({"duration":null}),
                serde_json::json!({"duration":0}), serde_json::json!({"duration":-1}),
                serde_json::json!({"duration":3601}), serde_json::json!({"duration":"3.5"}),
                serde_json::json!({"sentence":""}), serde_json::json!({"sentence":42}),
                serde_json::json!({"sentence":null}), serde_json::json!({"sentence":"a\nb"}),
                serde_json::json!({"sentence":"a".repeat(4097)}),
            ] {
                let mut invalid: serde_json::Value = serde_json::from_str(payload).unwrap();
                for (key, value) in patch.as_object().unwrap() { invalid[key] = value.clone(); }
                assert!(parse_pesan(topic, &invalid.to_string()).is_err(), "{invalid}");
            }
            assert!(parse_pesan(topic, r#"{"sentence":"Halo"}"#).is_err());
        }
        let alias = parse_pesan(TOPIC_LLM_EKSPRESI, r#"{"expression":"excited","duration":1,"sentence":"Halo"}"#).unwrap();
        assert_eq!(alias, vec![Pesan::Sentence { expression: "happier".into(), duration: 1.0, sentence: "Halo".into() }]);
        assert!(validasi_pesan(&Pesan::Sentence { expression: "happy".into(), duration: 1.0, sentence: "a".repeat(4096) }).is_ok());
        assert!(DEFAULT_TOPICS.contains(&TOPIC_LLM_SENTENCE));
    }

    #[test]
    fn test_word_stream_contract() {
        assert_eq!(pesan_dari_llm(TOPIC_LLM_WORD, r#"{"word":"belum"}"#).unwrap(),
            vec![Pesan::Word { word: "belum".into() }]);
        for payload in [r#"{"word":""}"#, r#"{"word":42}"#, r#"{}"#] {
            assert!(pesan_dari_llm(TOPIC_LLM_WORD, payload).is_err());
        }
        assert!(validasi_pesan(&Pesan::Word { word: "x".repeat(257) }).is_err());
        assert!(pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"tts","state":"progress"}"#).unwrap().is_empty());
        assert!(pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"happy","duration":-1}"#).is_err());
    }
}
