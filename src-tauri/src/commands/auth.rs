//! Penanganan verifikasi autentikasi ganti mode operator (AC-16.9).

use log::{info, warn};
use tauri::command;

pub const DEFAULT_PASSWORD: &str = "";

/// Memeriksa password yang dimasukkan operator untuk beralih mode.
/// Prioritas:
/// 1. Environment variable BRONE_MODE_PASSWORD jika diset
/// 2. File konfigurasi lokal `config/config.local.json` (git-ignored) untuk testing lokal
pub fn check_password(input: &str) -> bool {
    if input.is_empty() {
        return false;
    }

    // 1. Cek environment variable BRONE_MODE_PASSWORD jika diset
    if let Ok(target) = std::env::var("BRONE_MODE_PASSWORD") {
        if !target.is_empty() {
            return input == target;
        }
    }

    // 2. Cek file lokal config/config.local.json untuk dev/testing lokal
    let possible_paths = [
        "config/config.local.json",
        "../config/config.local.json",
        "../../config/config.local.json",
    ];

    for path in possible_paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(pwd) = parsed
                    .get("mode")
                    .and_then(|m| m.get("dev_fallback_password"))
                    .and_then(|p| p.as_str())
                {
                    if !pwd.is_empty() {
                        return input == pwd;
                    }
                }
            }
        }
    }

    false
}

#[command]
pub fn verify_mode_password(password: String) -> bool {
    let success = check_password(&password);
    if success {
        info!("[Auth] Verifikasi password mode berhasil.");
    } else {
        warn!("[Auth] Percobaan password mode gagal atau kosong.");
    }
    success
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_benar_env() {
        std::env::set_var("BRONE_MODE_PASSWORD", "secret123");
        assert!(check_password("secret123"));
    }

    #[test]
    fn test_password_salah() {
        std::env::set_var("BRONE_MODE_PASSWORD", "secret123");
        assert!(!check_password("salah_password"));
        assert!(!check_password("123456"));
        assert!(!check_password("SECRET123")); // case-sensitive
    }

    #[test]
    fn test_password_kosong() {
        assert!(!check_password(""));
        assert!(!check_password(" "));
    }
}
