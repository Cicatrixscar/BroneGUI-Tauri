# Keputusan

## 1. Framework: Tauri
- Target: NUC (Linux). GUI 2D.
- Alasan: UI tetap web (JavaScript), backend native ringan dengan Rust, bisa dipaket sebagai aplikasi desktop.
- Yang belum terbukti: memori dan FPS Tauri (WebKitGTK) di Linux. Diukur di NUC lewat `benchmark/`.
- Pembanding yang tetap dicatat: Brave kiosk (kondisi GUI lama).

## 2. Bahasa
- FE: JavaScript.
- BE: Rust (hanya connector).

## 3. Di luar cakupan repo ini
- LLM, STT, TTS: modul terpisah, tim lain.
- Deteksi wajah dan klasifikasi emosi dari kamera: tim vision.
