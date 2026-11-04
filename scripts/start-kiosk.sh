#!/usr/bin/env bash
# ==============================================================================
# Script peluncur Brone GUI di Intel NUC (Ubuntu 22.04 LTS + Wayland)
# ==============================================================================

set -e

# 1. Penanganan khusus WebKitGTK di Intel Alder Lake GPU + Wayland (menghindari glitch render/crash)
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export GDK_BACKEND=wayland,x11

# 2. Konfigurasi MQTT Broker & Auth
export BRONE_MQTT_HOST="${BRONE_MQTT_HOST:-127.0.0.1}"
export BRONE_MQTT_PORT="${BRONE_MQTT_PORT:-1883}"
# Set password operator via env var BRONE_MODE_PASSWORD
export BRONE_MODE_PASSWORD="${BRONE_MODE_PASSWORD:-}"

# 3. Direktori aplikasi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "[Brone] Menjalankan Brone GUI..."
echo "[Brone] Broker MQTT: ${BRONE_MQTT_HOST}:${BRONE_MQTT_PORT}"
echo "[Brone] Layar target: 1024x600 (Wayland)"

# 4. Jalankan binary Tauri
if [ -f "./src-tauri/target/release/brone-gui" ]; then
    exec ./src-tauri/target/release/brone-gui
elif [ -f "./src-tauri/target/debug/brone-gui" ]; then
    exec ./src-tauri/target/debug/brone-gui
else
    echo "[Brone] Binary belum dikompilasi. Jalankan 'cargo build --release' di folder src-tauri terlebih dahulu."
    exit 1
fi

