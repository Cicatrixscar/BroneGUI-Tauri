#!/usr/bin/env python3
"""
tes_viseme.py — Dummy script untuk tes tembak MQTT ke BroneGUI

Jalankan dari NUC (atau Jetson langsung):
    python3 kasih-LLM/tes_viseme.py
    python3 kasih-LLM/tes_viseme.py --broker 192.168.100.2
    python3 kasih-LLM/tes_viseme.py --broker 192.168.100.2 --skenario 3
    python3 kasih-LLM/tes_viseme.py --semua          # jalankan semua skenario otomatis

Dependensi:
    pip install paho-mqtt
"""

import argparse
import json
import sys
import time

try:
    import paho.mqtt.client as mqtt
    import paho.mqtt.publish as publish
except ImportError:
    print("❌ paho-mqtt belum terinstall. Jalankan: pip install paho-mqtt")
    sys.exit(1)

# ─── Konfigurasi default ──────────────────────────────────────────────────────
DEFAULT_BROKER = "192.168.100.2"   # IP Jetson dari NUC (ganti ke localhost kalau dari Jetson)
DEFAULT_PORT   = 1883
TOPIC_EKSPRESI = "robot/expression"
TOPIC_STAGE    = "robot/voice_stage"

# ─── Warna terminal ───────────────────────────────────────────────────────────
GRN = "\033[92m"; YLW = "\033[93m"; RED = "\033[91m"; CYN = "\033[96m"; RST = "\033[0m"; BLD = "\033[1m"

# ─── Semua skenario tes ───────────────────────────────────────────────────────
SKENARIO = [
    {
        "id": 1,
        "nama": "Ekspresi saja (tanpa bicara)",
        "keterangan": "Wajah harus ganti ke 'happy'. Tidak ada animasi mulut.",
        "topic": TOPIC_EKSPRESI,
        "payload": {"expression": "happy"},
    },
    {
        "id": 2,
        "nama": "Ekspresi + durasi (format lama brone-talk)",
        "keterangan": "Wajah ganti ke 'happy', mulut fallback TIDAK aktif (fallbackMulutAktif=false). "
                      "Setelah 3 detik, ekspresi di-hold lalu balik ke idle dalam 4 detik.",
        "topic": TOPIC_EKSPRESI,
        "payload": {"expression": "happy", "duration": 3.0},
    },
    {
        "id": 3,
        "nama": "Paket GABUNGAN: ekspresi + durasi + viseme jadwal (format Indonesia)",
        "keterangan": "Ini skenario utama viseme! Wajah ganti ke 'happy', "
                      "viseme schedule jalan (REST→A→O→REST→A), mulut ikut suku kata. "
                      "Pakai field Indonesia: 'ekspresi', 'durasi_s', 'viseme'.",
        "topic": TOPIC_EKSPRESI,
        "payload": {
            "ekspresi": "happy",       # alias Indonesia — diterima backend
            "durasi_s": 3.2,           # alias Indonesia untuk 'duration'
            "viseme": [
                {"t": 0.0,  "v": "REST"},
                {"t": 0.1,  "v": "A"},
                {"t": 0.25, "v": "O"},
                {"t": 0.45, "v": "REST"},
                {"t": 0.6,  "v": "A"},
                {"t": 0.9,  "v": "REST"},
                {"t": 1.2,  "v": "I"},
                {"t": 1.5,  "v": "REST"},
                {"t": 2.0,  "v": "U"},
                {"t": 2.5,  "v": "REST"},
                {"t": 3.0,  "v": "A"},
                {"t": 3.2,  "v": "DIAM"},
            ],
        },
    },
    {
        "id": 4,
        "nama": "Format 'speaking' (sinyal mulai bicara, format lama)",
        "keterangan": "Hanya emit Bicara{mulai}. Wajah TIDAK ganti ekspresi.",
        "topic": TOPIC_EKSPRESI,
        "payload": {"expression": "speaking", "duration": 2.5},
    },
    {
        "id": 5,
        "nama": "voice_stage: LLM start (ekspresi thinking/confused)",
        "keterangan": "Wajah harus ganti ke 'confused' (alias ekspresi berpikir).",
        "topic": TOPIC_STAGE,
        "payload": {"stage": "llm", "state": "start", "ts": time.time()},
    },
    {
        "id": 6,
        "nama": "voice_stage: TTS start (mulai bicara)",
        "keterangan": "Emit Bicara{mulai} tanpa ganti ekspresi.",
        "topic": TOPIC_STAGE,
        "payload": {"stage": "tts", "state": "start"},
    },
    {
        "id": 7,
        "nama": "voice_stage: TTS end (selesai bicara)",
        "keterangan": "Emit Bicara{selesai}. Hold timer mulai (4 detik), lalu balik idle.",
        "topic": TOPIC_STAGE,
        "payload": {"stage": "tts", "state": "end"},
    },
    {
        "id": 8,
        "nama": "voice_stage: idle/standby (paksa balik ke idle)",
        "keterangan": "Wajah harus balik ke ekspresi 'idle' (default).",
        "topic": TOPIC_STAGE,
        "payload": {"stage": "idle", "state": "standby"},
    },
    {
        "id": 9,
        "nama": "Ekspresi tidak dikenal (harus ditolak Rust)",
        "keterangan": "Payload ini HARUS dibuang oleh backend. Tidak ada perubahan wajah.",
        "topic": TOPIC_EKSPRESI,
        "payload": {"expression": "marah"},   # bukan dalam VALID_EMOSI (harus pakai 'angry')
    },
    {
        "id": 10,
        "nama": "Reset manual ke neutral/idle",
        "keterangan": "Wajah kembali ke ekspresi default 'idle'.",
        "topic": TOPIC_EKSPRESI,
        "payload": {"expression": "neutral"},
    },
]


def tembak(broker: str, port: int, topic: str, payload: dict):
    """Publish satu pesan MQTT dan print hasilnya."""
    payload_str = json.dumps(payload)
    try:
        publish.single(topic, payload_str, hostname=broker, port=port)
        print(f"  {GRN}✓ Terkirim{RST} → topic: {CYN}{topic}{RST}")
        print(f"  {GRN}  payload:{RST} {payload_str}")
    except Exception as e:
        print(f"  {RED}✗ Gagal kirim: {e}{RST}")


def tampilkan_menu():
    print(f"\n{BLD}{'─'*60}")
    print(f"  🤖  BroneGUI Viseme Test Script")
    print(f"{'─'*60}{RST}")
    for s in SKENARIO:
        print(f"  {YLW}[{s['id']:2}]{RST} {s['nama']}")
    print(f"  {YLW}[ A]{RST} Jalankan semua skenario (dengan jeda)")
    print(f"  {YLW}[ Q]{RST} Keluar")
    print(f"{'─'*60}")


def jalankan_skenario(s: dict, broker: str, port: int):
    print(f"\n{BLD}{YLW}▶ Skenario {s['id']}: {s['nama']}{RST}")
    print(f"  {CYN}Info:{RST} {s['keterangan']}")
    tembak(broker, port, s["topic"], s["payload"])


def main():
    parser = argparse.ArgumentParser(description="Tes tembak MQTT viseme ke BroneGUI")
    parser.add_argument("--broker",    default=DEFAULT_BROKER, help=f"IP broker MQTT (default: {DEFAULT_BROKER})")
    parser.add_argument("--port",      default=DEFAULT_PORT,   type=int, help=f"Port broker (default: {DEFAULT_PORT})")
    parser.add_argument("--skenario",  default=None,           type=int, help="Nomor skenario yang langsung dijalankan (1-10)")
    parser.add_argument("--semua",     action="store_true",    help="Jalankan semua skenario otomatis dengan jeda 2.5 detik")
    parser.add_argument("--jeda",      default=2.5,            type=float, help="Jeda antar skenario saat --semua (detik, default: 2.5)")
    args = parser.parse_args()

    print(f"\n{BLD}Broker target: {CYN}{args.broker}:{args.port}{RST}")

    # ── Tes koneksi dulu ──────────────────────────────────────────────────────
    print("Mengecek koneksi ke broker...", end=" ", flush=True)
    client = mqtt.Client()
    try:
        client.connect(args.broker, args.port, keepalive=5)
        client.disconnect()
        print(f"{GRN}✓ Terhubung{RST}")
    except Exception as e:
        print(f"{RED}✗ GAGAL: {e}{RST}")
        print(f"{YLW}Pastikan broker mosquitto jalan di {args.broker}:{args.port}{RST}")
        sys.exit(1)

    # ── Mode: satu skenario langsung ─────────────────────────────────────────
    if args.skenario is not None:
        s = next((x for x in SKENARIO if x["id"] == args.skenario), None)
        if s is None:
            print(f"{RED}Skenario {args.skenario} tidak ditemukan.{RST}")
            sys.exit(1)
        jalankan_skenario(s, args.broker, args.port)
        return

    # ── Mode: semua skenario otomatis ────────────────────────────────────────
    if args.semua:
        print(f"\n{BLD}Menjalankan semua {len(SKENARIO)} skenario dengan jeda {args.jeda}s...{RST}\n")
        for s in SKENARIO:
            jalankan_skenario(s, args.broker, args.port)
            time.sleep(args.jeda)
        print(f"\n{GRN}{BLD}✓ Semua skenario selesai.{RST}")
        return

    # ── Mode: menu interaktif ────────────────────────────────────────────────
    while True:
        tampilkan_menu()
        pilihan = input(f"Pilih skenario (1-{len(SKENARIO)} / A / Q): ").strip().upper()

        if pilihan == "Q":
            print("Keluar.")
            break
        elif pilihan == "A":
            print(f"\n{BLD}Menjalankan semua skenario dengan jeda {args.jeda}s...{RST}")
            for s in SKENARIO:
                jalankan_skenario(s, args.broker, args.port)
                time.sleep(args.jeda)
            print(f"\n{GRN}{BLD}✓ Selesai.{RST}")
        elif pilihan.isdigit():
            nomor = int(pilihan)
            s = next((x for x in SKENARIO if x["id"] == nomor), None)
            if s:
                jalankan_skenario(s, args.broker, args.port)
            else:
                print(f"{RED}Nomor tidak valid.{RST}")
        else:
            print(f"{RED}Input tidak dikenal.{RST}")


if __name__ == "__main__":
    main()
