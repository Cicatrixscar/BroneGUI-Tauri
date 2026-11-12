//! Modul client MQTT untuk menerima pesan dari sistem robot (Mosquitto broker).

use log::{error, info, warn};
use rumqttc::{AsyncClient, MqttOptions, QoS};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::protocol::{pesan_dari_llm, validasi_pesan, Pesan};

#[derive(Debug, Clone)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub topics: Vec<String>,
}

impl Default for MqttConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 1883,
            client_id: "brone_gui_display".into(),
            topics: vec![
                // Kontrak asli `brone-talk`, diterjemahkan oleh adapter protocol.rs.
                "robot/expression".into(),
                "robot/voice_stage".into(),
                // Kontrak GUI lama, tetap didukung untuk uji manual.
                "brone/face/ekspresi".into(),
                "brone/face/viseme".into(),
                "brone/face/bicara".into(),
            ],
        }
    }
}

fn parse_pesan(topic: &str, payload: &str) -> Result<Option<Pesan>, String> {
    if topic.starts_with("robot/") {
        pesan_dari_llm(topic, payload)
    } else {
        serde_json::from_str::<Pesan>(payload)
            .map(Some)
            .map_err(|e| format!("JSON tidak sesuai kontrak GUI: {e}"))
    }
}

/// Menjalankan client MQTT di background task Tokio.
pub async fn start_mqtt_client(app_handle: AppHandle, config: MqttConfig) {
    let mut mqttoptions = MqttOptions::new(&config.client_id, &config.host, config.port);
    mqttoptions.set_keep_alive(Duration::from_secs(15));
    mqttoptions.set_clean_session(true);

    info!(
        "[MQTT] Menghubungkan ke broker {}:{} sebagai client '{}'",
        config.host, config.port, config.client_id
    );

    let (client, mut eventloop) = AsyncClient::new(mqttoptions, 10);

    // Loop penanganan pesan dan event jaringan
    loop {
        match eventloop.poll().await {
            // clean_session=true menghapus langganan saat reconnect. Daftarkan ulang
            // setiap ConnAck supaya wajah tetap menerima pesan setelah broker sempat putus.
            Ok(rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(_))) => {
                info!("[MQTT] Terhubung ke broker. Mendaftarkan langganan topik.");
                for topic in &config.topics {
                    if let Err(e) = client.subscribe(topic, QoS::AtLeastOnce).await {
                        warn!("[MQTT] Gagal berlangganan topik {}: {}", topic, e);
                    } else {
                        info!("[MQTT] Berlangganan topik: {}", topic);
                    }
                }
            }
            Ok(rumqttc::Event::Incoming(rumqttc::Packet::Publish(publish))) => {
                let payload_str = match std::str::from_utf8(&publish.payload) {
                    Ok(s) => s,
                    Err(e) => {
                        warn!(
                            "[MQTT] Payload pada topik '{}' bukan string UTF-8 valid: {}",
                            publish.topic, e
                        );
                        continue;
                    }
                };

                info!("[MQTT] Pesan masuk di '{}': {}", publish.topic, payload_str);

                match parse_pesan(&publish.topic, payload_str) {
                    Ok(Some(pesan)) => {
                        // Validasi pesan (AC-17.4 / CONTRACT.md)
                        if let Err(err_msg) = validasi_pesan(&pesan) {
                            warn!(
                                "[MQTT] Pesan dibuang karena tidak valid: {} (payload: {})",
                                err_msg, payload_str
                            );
                            continue;
                        }

                        // Pancarkan event ke Frontend Tauri
                        let event_name = match &pesan {
                            Pesan::Ekspresi { .. } => "brone://ekspresi",
                            Pesan::Viseme { .. } => "brone://viseme",
                            Pesan::Bicara { .. } => "brone://bicara",
                        };

                        let val = serde_json::to_value(&pesan).unwrap_or_default();

                        // Emit ke event spesifik sesuai tipe pesan ke Frontend
                        if let Err(e) = app_handle.emit(event_name, &val) {
                            error!("[Tauri IPC] Gagal memancarkan event '{}': {}", event_name, e);
                        }
                    }
                    Ok(None) => {
                        info!(
                            "[MQTT] Pesan di topik '{}' tidak mengubah wajah, diabaikan.",
                            publish.topic
                        );
                    }
                    Err(e) => {
                        warn!(
                            "[MQTT] Gagal memproses pesan dari topik '{}': {} (payload: {})",
                            publish.topic, e, payload_str
                        );
                    }
                }
            }
            Ok(_) => {}
            Err(e) => {
                warn!(
                    "[MQTT] Gangguan koneksi broker (akan mencoba reconnect otomatis): {:?}",
                    e
                );
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}
