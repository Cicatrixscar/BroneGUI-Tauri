//! Model dan validasi pesan sesuai docs/CONTRACT.md.

use serde::{Deserialize, Serialize};

/// Topik yang benar-benar dipakai `brone-talk` (lihat laporan audit 11 Nov 2026).
pub const TOPIC_LLM_EKSPRESI: &str = "robot/expression";
pub const TOPIC_LLM_WORD: &str = "robot/word";
pub const TOPIC_LLM_VOICE_STAGE: &str = "robot/voice_stage";

pub const VALID_EMOSI: &[&str] = &[
    // Nama baru (English / LLM format)
    "idle",
    "happy",
    "happier",
    "happier_transisi",
    "sad",
    "cry",
    "shock",
    "confused",
    "thinking",
    "timeout",
    // Alias lama (Indonesian) untuk kompatibilitas
    "netral",
    "senang",
    "sangat_senang",
    "sangat_senang_transisi",
    "sedih",
    "menangis",
    "terkejut",
    "berpikir",
];

pub const VALID_VISEME: &[&str] = &[
    // Sistem viseme baru (Vokal + REST)
    "A", "I", "U", "E", "O", "REST", "DIAM",
    // Kompatibilitas mundur viseme lama
    "P_B_M", "TH", "N_L", "T_D", "F_V", "K", "C_J_SY", "S_Z", "R", "I_G",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisemeItem {
    pub t: f32,
    pub v: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "tipe")]
pub enum Pesan {
    #[serde(rename = "ekspresi")]
    Ekspresi {
        #[serde(default)]
        id: String,
        emosi: String,
        #[serde(default = "default_intensitas")]
        intensitas: f32,
        #[serde(default)]
        durasi_ms: Option<u32>,
    },
    #[serde(rename = "viseme")]
    Viseme {
        #[serde(default)]
        id: String,
        jadwal: Vec<VisemeItem>,
    },
    #[serde(rename = "word")]
    Word { word: String },
    #[serde(rename = "bicara")]
    Bicara {
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        durasi_s: Option<f32>,
    },
}

fn default_intensitas() -> f32 {
    1.0
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
    if topic == TOPIC_LLM_WORD {
        #[derive(Deserialize)]
        struct WordPayload { word: String }
        let raw: WordPayload = serde_json::from_str(payload)
            .map_err(|e| format!("JSON word tidak valid: {e}"))?;
        let message = Pesan::Word { word: raw.word };
        validasi_pesan(&message).map_err(str::to_string)?;
        return Ok(vec![message]);
    }
    if topic == TOPIC_LLM_EKSPRESI {
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

/// Memvalidasi isi pesan sesuai aturan kontrak di docs/CONTRACT.md.
pub fn validasi_pesan(p: &Pesan) -> Result<(), &'static str> {
    match p {
        Pesan::Ekspresi { emosi, intensitas, .. } => {
            if !(0.0..=1.0).contains(intensitas) {
                return Err("Intensitas harus bernilai antara 0.0 dan 1.0");
            }
            if !VALID_EMOSI.contains(&emosi.as_str()) {
                return Err("Nama emosi tidak dikenal dalam kontrak");
            }
            Ok(())
        }
        Pesan::Word { word } => {
            if word.trim().is_empty() || word.chars().count() > 256 || word.chars().any(char::is_control) {
                return Err("Word harus berisi 1-256 karakter tanpa karakter kontrol");
            }
            Ok(())
        }
        Pesan::Viseme { jadwal, .. } => {
            if jadwal.is_empty() {
                return Err("Jadwal viseme tidak boleh kosong");
            }
            for item in jadwal {
                if !item.t.is_finite() || item.t < 0.0 {
                    return Err("Waktu timestamp t tidak boleh negatif");
                }
                if !VALID_VISEME.contains(&item.v.as_str()) {
                    return Err("Kode viseme tidak dikenal dalam kontrak");
                }
            }
            Ok(())
        }
        Pesan::Bicara { status, durasi_s } => {
            if status != "mulai" && status != "selesai" {
                return Err("Status bicara harus 'mulai' atau 'selesai'");
            }
            if let Some(d) = durasi_s {
                if !d.is_finite() || *d <= 0.0 || *d > 3600.0 {
                    return Err("Durasi bicara harus positif dan paling lama 3600 detik");
                }
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validasi_ekspresi() {
        let p_valid = Pesan::Ekspresi {
            id: "1".into(),
            emosi: "happy".into(),
            intensitas: 0.8,
            durasi_ms: Some(2000),
        };
        assert!(validasi_pesan(&p_valid).is_ok());

        // Alias lama harus tetap valid
        let p_alias = Pesan::Ekspresi {
            id: "1b".into(),
            emosi: "senang".into(),
            intensitas: 0.8,
            durasi_ms: Some(2000),
        };
        assert!(validasi_pesan(&p_alias).is_ok());

        let p_intensitas_salah = Pesan::Ekspresi {
            id: "2".into(),
            emosi: "happy".into(),
            intensitas: 1.5,
            durasi_ms: None,
        };
        assert!(validasi_pesan(&p_intensitas_salah).is_err());

        let p_emosi_salah = Pesan::Ekspresi {
            id: "3".into(),
            emosi: "marah".into(),
            intensitas: 0.5,
            durasi_ms: None,
        };
        assert!(validasi_pesan(&p_emosi_salah).is_err());
    }

    #[test]
    fn test_validasi_viseme() {
        let p_valid = Pesan::Viseme {
            id: "v1".into(),
            jadwal: vec![
                VisemeItem { t: 0.0, v: "A".into() },
                VisemeItem { t: 0.15, v: "P_B_M".into() },
            ],
        };
        assert!(validasi_pesan(&p_valid).is_ok());

        let p_kosong = Pesan::Viseme {
            id: "v2".into(),
            jadwal: vec![],
        };
        assert!(validasi_pesan(&p_kosong).is_err());

        let p_viseme_invalid = Pesan::Viseme {
            id: "v3".into(),
            jadwal: vec![VisemeItem { t: 0.1, v: "XYZ".into() }],
        };
        assert!(validasi_pesan(&p_viseme_invalid).is_err());
    }

    #[test]
    fn test_validasi_bicara() {
        let b1 = Pesan::Bicara { status: "mulai".into(), durasi_s: None };
        assert!(validasi_pesan(&b1).is_ok());

        let b2 = Pesan::Bicara { status: "selesai".into(), durasi_s: Some(3.5) };
        assert!(validasi_pesan(&b2).is_ok());

        let b3 = Pesan::Bicara { status: "berhenti".into(), durasi_s: None };
        assert!(validasi_pesan(&b3).is_err());
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
