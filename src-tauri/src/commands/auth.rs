//! Penanganan ganti mode operator.
//! Catatan: Fitur password telah dinonaktifkan (mode switch bebas tanpa password).

use tauri::command;

pub fn check_password(_input: &str) -> bool {
    true
}

#[command]
pub fn verify_mode_password(_password: Option<String>) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mode_switch_tanpa_password() {
        assert!(check_password("anything"));
        assert!(check_password(""));
    }
}
