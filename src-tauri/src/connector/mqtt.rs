//! Modul client MQTT untuk menerima pesan dari sistem robot (Mosquitto broker).

use log::{debug, error, info, warn};
use rumqttc::{AsyncClient, MqttOptions, QoS};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::ingress::{parse_pesan, DEFAULT_TOPICS};
use super::protocol::validasi_pesan;

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
            topics: DEFAULT_TOPICS.iter().map(|topic| (*topic).to_owned()).collect(),
        }
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

                debug!("[MQTT] Pesan masuk di '{}': {}", publish.topic, payload_str);

                match parse_pesan(&publish.topic, payload_str) {
                    Ok(pesan_list) => {
                        if pesan_list.is_empty() {
                            info!(
                                "[MQTT] Pesan di topik '{}' tidak mengubah wajah, diabaikan.",
                                publish.topic
                            );
                            continue;
                        }

                        for pesan in pesan_list {
                            // Validasi pesan (AC-17.4 / CONTRACT.md)
                            if let Err(err_msg) = validasi_pesan(&pesan) {
                                warn!(
                                    "[MQTT] Pesan dibuang karena tidak valid: {} (payload: {})",
                                    err_msg, payload_str
                                );
                                continue;
                            }

                            // Pancarkan event ke Frontend Tauri
                            let event_name = pesan.event_name();
                            let val = match serde_json::to_value(&pesan) {
                                Ok(val) => val,
                                Err(e) => {
                                    error!("[Tauri IPC] Serialisasi event '{}' gagal: {}", event_name, e);
                                    continue;
                                }
                            };

                            // Emit ke event spesifik sesuai tipe pesan ke Frontend
                            if let Err(e) = app_handle.emit(event_name, &val) {
                                error!("[Tauri IPC] Gagal memancarkan event '{}': {}", event_name, e);
                            }
                        }
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
