//! Model dan validasi pesan sesuai docs/CONTRACT.md.

use serde::{Deserialize, Serialize};

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
    "P_B_M", "TH", "N_L", "T_D", "F_V", "K", "C_J_SY", "S_Z", "R", "A", "E", "I_G", "O", "U", "DIAM",
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
}
