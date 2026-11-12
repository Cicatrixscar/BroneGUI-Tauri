//! Model dan validasi pesan sesuai docs/CONTRACT.md.

use serde::{Deserialize, Serialize};

/// Topik yang benar-benar dipakai `brone-talk` (lihat laporan audit 11 Nov 2026).
pub const TOPIC_LLM_EKSPRESI: &str = "robot/expression";
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
    #[serde(rename = "bicara")]
    Bicara {
        status: String,
    },
}

fn default_intensitas() -> f32 {
    1.0
}

#[derive(Deserialize)]
struct LlmExpression {
    expression: String,
    /// Durasi audio TTS dalam detik (format `brone-talk`).
    #[serde(default)]
    duration: Option<f64>,
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
        "thinking" | "berpikir" => Some("thinking"),
        "timeout" => Some("timeout"),
        "excited" => Some("happier"),
        "confused" => Some("shock"),
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
pub fn pesan_dari_llm(topic: &str, payload: &str) -> Result<Option<Pesan>, String> {
    if topic == TOPIC_LLM_EKSPRESI {
        let raw: LlmExpression = serde_json::from_str(payload)
            .map_err(|e| format!("JSON ekspresi LLM tidak valid: {e}"))?;
        if raw.expression.eq_ignore_ascii_case("speaking") {
            // GUI tidak menerima emosi "speaking"; ini penanda mulai bicara.
            return Ok(Some(Pesan::Bicara {
                status: "mulai".into(),
            }));
        }
        let emosi = petakan_emosi(&raw.expression)
            .ok_or_else(|| format!("Ekspresi LLM tidak dikenal: {}", raw.expression))?;
        let durasi_ms = raw
            .duration
            .map(|detik| (detik.max(0.0) * 1000.0) as u32)
            .filter(|ms| *ms > 0);
        Ok(Some(Pesan::Ekspresi {
            id: String::new(),
            emosi: emosi.into(),
            intensitas: 1.0,
            durasi_ms,
        }))
    } else if topic == TOPIC_LLM_VOICE_STAGE {
        let raw: LlmVoiceStage = serde_json::from_str(payload)
            .map_err(|e| format!("JSON voice_stage LLM tidak valid: {e}"))?;
        let stage = raw.stage.to_ascii_lowercase();
        let state = raw.state.to_ascii_lowercase();

        if stage == "error" || state == "error" {
            return Ok(Some(ekspresi("timeout")));
        }
        match (stage.as_str(), state.as_str()) {
            ("llm", "start") => Ok(Some(ekspresi("thinking"))),
            ("tts", "start") => Ok(Some(Pesan::Bicara {
                status: "mulai".into(),
            })),
            ("tts", _) => Ok(Some(Pesan::Bicara {
                status: "selesai".into(),
            })),
            _ => Ok(None),
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
        Pesan::Viseme { jadwal, .. } => {
            if jadwal.is_empty() {
                return Err("Jadwal viseme tidak boleh kosong");
            }
            for item in jadwal {
                if item.t < 0.0 {
                    return Err("Waktu timestamp t tidak boleh negatif");
                }
                if !VALID_VISEME.contains(&item.v.as_str()) {
                    return Err("Kode viseme tidak dikenal dalam kontrak");
                }
            }
            Ok(())
        }
        Pesan::Bicara { status } => {
            if status != "mulai" && status != "selesai" {
                return Err("Status bicara harus 'mulai' atau 'selesai'");
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
        let b1 = Pesan::Bicara { status: "mulai".into() };
        assert!(validasi_pesan(&b1).is_ok());

        let b2 = Pesan::Bicara { status: "selesai".into() };
        assert!(validasi_pesan(&b2).is_ok());

        let b3 = Pesan::Bicara { status: "berhenti".into() };
        assert!(validasi_pesan(&b3).is_err());
    }

    #[test]
    fn test_adapter_ekspresi_llm() {
        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"neutral"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(p, ekspresi("idle"));

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"excited"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(p, ekspresi("happier"));

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"confused"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(p, ekspresi("shock"));

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"speaking","duration":4}"#)
            .unwrap()
            .unwrap();
        assert_eq!(p, Pesan::Bicara { status: "mulai".into() });

        let p = pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"happy","duration":2.5}"#)
            .unwrap()
            .unwrap();
        assert_eq!(
            p,
            Pesan::Ekspresi {
                id: String::new(),
                emosi: "happy".into(),
                intensitas: 1.0,
                durasi_ms: Some(2500),
            }
        );

        assert!(pesan_dari_llm(TOPIC_LLM_EKSPRESI, r#"{"expression":"marah"}"#).is_err());
    }

    #[test]
    fn test_adapter_voice_stage_llm() {
        let p = pesan_dari_llm(
            TOPIC_LLM_VOICE_STAGE,
            r#"{"stage":"llm","state":"start","ts":1.0}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(p, ekspresi("thinking"));

        let p = pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"error","state":"llm"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(p, ekspresi("timeout"));

        let p = pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"tts","state":"start"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(p, Pesan::Bicara { status: "mulai".into() });

        let p = pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"tts","state":"end"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(p, Pesan::Bicara { status: "selesai".into() });

        assert!(pesan_dari_llm(TOPIC_LLM_VOICE_STAGE, r#"{"stage":"vad","state":"start"}"#)
            .unwrap()
            .is_none());
    }
}
