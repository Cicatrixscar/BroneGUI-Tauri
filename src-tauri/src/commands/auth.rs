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

#[command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[command]
pub fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!is_fullscreen).map_err(|e| e.to_string())?;
    Ok(!is_fullscreen)
}

#[command]
pub fn is_fullscreen(window: tauri::Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
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
