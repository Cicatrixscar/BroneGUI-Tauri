pub mod commands;
pub mod connector;

use commands::auth::{exit_app, is_fullscreen, toggle_fullscreen, verify_mode_password};
use connector::mqtt::{start_mqtt_client, MqttConfig};
use log::info;
use tauri::Manager;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("[Brone] Memulai Tauri Backend v2...");

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            // Baca konfigurasi MQTT dari environment variable (atau default)
            let mqtt_config = MqttConfig {
                host: std::env::var("BRONE_MQTT_HOST")
                    .unwrap_or_else(|_| "127.0.0.1".to_string()),
                port: std::env::var("BRONE_MQTT_PORT")
                    .ok()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(1883),
                client_id: "brone_gui_robot_display".to_string(),
                topics: vec![
                    "brone/face/ekspresi".to_string(),
                    "brone/face/viseme".to_string(),
                    "brone/face/bicara".to_string(),
                    "brone/face/+".to_string(),
                ],
            };

            // Jalankan listener MQTT di task Tokio async background
            tauri::async_runtime::spawn(async move {
                start_mqtt_client(handle, mqtt_config).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            verify_mode_password,
            exit_app,
            toggle_fullscreen,
            is_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan aplikasi Tauri");
}
