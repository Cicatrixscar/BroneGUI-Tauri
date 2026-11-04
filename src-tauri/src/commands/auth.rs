//! Penanganan verifikasi autentikasi ganti mode operator (AC-16.9).

use log::{info, warn};
use tauri::command;

pub const DEFAULT_PASSWORD: &str = "";

/// Memeriksa password yang dimasukkan operator untuk beralih mode.
/// Membaca dari environment variable BRONE_MODE_PASSWORD jika diset.
pub fn check_password(input: &str) -> bool {
    if input.is_empty() {
        return false;
    }

    let target = std::env::var("BRONE_MODE_PASSWORD").unwrap_or_else(|_| DEFAULT_PASSWORD.to_string());
    if target.is_empty() {
        return false;
    }
    input == target
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
    fn test_password_benar() {
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
