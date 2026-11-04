//! Connector: menerima pesan dari broker MQTT, memvalidasi sesuai kontrak, lalu meneruskan ke FE via Tauri Event IPC.

pub mod mqtt;
pub mod protocol;
