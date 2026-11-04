# Protokol benchmark (NUC)

Metode mengacu pada paper Tauri vs Electron (Bagian III.D).

- Setiap skenario diulang 5 kali, masing-masing 60 detik.
- Sampling 1 detik. Catat RAM (RSS), CPU (%), dan FPS render.
- Kondisi: idle (tanpa pesan masuk) dan aktif (pesan ekspresi dan viseme terus datang).
- Sebelum run: tutup aplikasi lain, catat suhu dan versi WebKitGTK (`npx tauri info`).

Skenario:
1. Tauri, fullscreen.
2. Brave kiosk, halaman wajah yang sama (pembanding).

Hasil ditulis ke `benchmark/results/` (diabaikan git).
