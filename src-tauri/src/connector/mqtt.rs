//! Modul client MQTT untuk menerima pesan dari sistem robot (Mosquitto broker).

use log::{error, info, warn};
use rumqttc::{AsyncClient, MqttOptions, QoS};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::protocol::{validasi_pesan, Pesan};

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
                "brone/face/ekspresi".into(),
                "brone/face/viseme".into(),
                "brone/face/bicara".into(),
                "brone/face/+".into(),
            ],
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

    // Subscribe ke semua topik yang dikonfigurasi
    for topic in &config.topics {
        if let Err(e) = client.subscribe(topic, QoS::AtLeastOnce).await {
            warn!("[MQTT] Gagal mendaftarkan langganan awal ke topik {}: {}", topic, e);
        } else {
            info!("[MQTT] Berlangganan topik: {}", topic);
        }
    }

    // Loop penanganan pesan dan event jaringan
    loop {
        match eventloop.poll().await {
            Ok(notification) => {
                if let rumqttc::Event::Incoming(rumqttc::Packet::Publish(publish)) = notification {
                    let payload_str = match std::str::from_utf8(&publish.payload) {
                        Ok(s) => s,
                        Err(e) => {
                            warn!("[MQTT] Payload pada topik '{}' bukan string UTF-8 valid: {}", publish.topic, e);
                            continue;
                        }
                    };

                    info!("[MQTT] Pesan masuk di '{}': {}", publish.topic, payload_str);

                    // Parse JSON sesuai kontrak
                    match serde_json::from_str::<Pesan>(payload_str) {
                        Ok(pesan) => {
                            // Validasi pesan (AC-17.4 / CONTRACT.md)
                            if let Err(err_msg) = validasi_pesan(&pesan) {
                                warn!("[MQTT] Pesan dibuang karena tidak valid: {} (payload: {})", err_msg, payload_str);
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
                        Err(e) => {
                            warn!("[MQTT] Gagal parse JSON dari topik '{}': {} (payload: {})", publish.topic, e, payload_str);
                        }
                    }
                }
            }
            Err(e) => {
                warn!("[MQTT] Gangguan koneksi broker (akan mencoba reconnect otomatis): {:?}", e);
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}

