//! Model dan validasi pesan sesuai docs/CONTRACT.md.

use serde::{Deserialize, Serialize};

// Jalur publik lama tetap tersedia untuk pemanggil yang sudah memakai protocol.
pub use super::ingress::{
    pesan_dari_llm, TOPIC_LLM_EKSPRESI, TOPIC_LLM_VOICE_STAGE, TOPIC_LLM_WORD, TOPIC_LLM_SENTENCE,
};

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
    #[serde(rename = "gaze")]
    Gaze { x: f64 },
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
    #[serde(rename = "sentence")]
    Sentence { expression: String, duration: f64, sentence: String },
    #[serde(rename = "bicara")]
    Bicara {
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        durasi_s: Option<f32>,
    },
}

impl Pesan {
    pub fn event_name(&self) -> &'static str {
        match self {
            Self::Gaze { .. } => "brone://gaze",
            Self::Ekspresi { .. } => "brone://ekspresi",
            Self::Viseme { .. } => "brone://viseme",
            Self::Bicara { .. } => "brone://bicara",
            Self::Word { .. } => "brone://word",
            Self::Sentence { .. } => "brone://sentence",
        }
    }
}

fn default_intensitas() -> f32 {
    1.0
}

/// Memvalidasi isi pesan sesuai aturan kontrak di docs/CONTRACT.md.
pub fn validasi_pesan(p: &Pesan) -> Result<(), &'static str> {
    match p {
        Pesan::Gaze { x } => {
            if !x.is_finite() {
                return Err("Gaze x harus berupa angka finite");
            }
            Ok(())
        }
        Pesan::Ekspresi { emosi, intensitas, .. } => {
            if !(0.0..=1.0).contains(intensitas) {
                return Err("Intensitas harus bernilai antara 0.0 dan 1.0");
            }
            if !VALID_EMOSI.contains(&emosi.as_str()) {
                return Err("Nama emosi tidak dikenal dalam kontrak");
            }
            Ok(())
        }
        Pesan::Sentence { expression, duration, sentence } => {
            if !VALID_EMOSI.contains(&expression.as_str()) {
                return Err("Expression kalimat tidak dikenal dalam kontrak");
            }
            if !duration.is_finite() || *duration <= 0.0 || *duration > 3600.0 {
                return Err("Duration kalimat harus positif dan paling lama 3600 detik");
            }
            if sentence.trim().is_empty() || sentence.chars().count() > 4096 || sentence.chars().any(char::is_control) {
                return Err("Sentence harus berisi 1-4096 karakter tanpa karakter kontrol");
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

}
