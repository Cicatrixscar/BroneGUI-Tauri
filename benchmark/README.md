# Benchmark

Jalankan di NUC, bukan di VM.

```bash
# jalankan aplikasi dulu di terminal lain: npm run tauri dev (atau build release)
./sample_resources.sh brone-gui 60 results/tauri_idle_run1.csv
```

Catat juga FPS dari konsol aplikasi (dari requestAnimationFrame) dan versi WebKitGTK dari `npx tauri info`.
