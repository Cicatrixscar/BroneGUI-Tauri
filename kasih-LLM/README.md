# 🤝 Panduan Integrasi Wajah & Suara BRONE Robot (Untuk Tim LLM / NUC)

Halo Tim LLM / Suara (`brone-talk-nuc`)! 👋  
Folder ini disiapkan khusus oleh tim GUI Wajah (`BroneGUI-Tauri`) agar komunikasi ekspresi wajah dan sinkronisasi gerak bibir (viseme) robot kita berjalan mulus, natural, dan tanpa jeda.

---

## 🎯 Masalah yang Diselesaikan

Pada kode `brone_talk.py` sebelumnya:
1. Saat robot mulai bersuara di speaker, pesan yang dikirim ke MQTT adalah `{"expression": "speaking", "duration": 3.5}`.  
   *(Nilai `"speaking"` bukan nama emosi, sehingga mata robot tidak tahu harus tersenyum atau sedih).*
2. Emosi asli (misal `"happy"`) baru dikirim di blok `finally` **setelah** audio speaker selesai berbunyi.  
   *(Robot kelihatan bengong dulu waktu ngomong, baru senyum setelah suaranya mati).*
3. Piper TTS hanya menghasilkan durasi kasar tanpa jadwal fonem huruf/kata, sehingga mulut robot tidak tahu kapan harus mangap `A`, `I`, `U`, `E`, `O`.

---

## 💡 Solusi yang Disediakan

Kami telah membuatkan modul Python mandiri tanpa dependensi tambahan: **`viseme_generator.py`**.

Fungsi `create_speech_payload(expression, duration_s, text)` secara otomatis:
- Memecah teks jawaban menjadi jadwal huruf vokal (`A`, `I`, `U`, `E`, `O`) dan katup bibir (`REST`).
- Menghitung waktu (timestamp) tiap huruf disesuaikan dengan panjang audio Piper TTS.
- Memberikan bobot waktu lebih panjang untuk suku kata di akhir kata / sebelum jeda koma (mengikuti ayunan nada suara alami manusia).

### Format Paket Gabungan yang Dikirim ke `robot/expression`:
```json
{
  "expression": "happy",
  "duration": 3.5,
  "viseme": [
    {"t": 0.0, "v": "REST"},
    {"t": 0.04, "v": "A"},
    {"t": 0.13, "v": "O"},
    {"t": 0.26, "v": "REST"},
    {"t": 0.38, "v": "E"},
    {"t": 3.38, "v": "REST"},
    {"t": 3.5, "v": "DIAM"}
  ]
}
```

---

## 🛠️ Cara Integrasi ke `brone_talk.py` (Hanya 3 Langkah!)

1. Salin file `viseme_generator.py` ke folder kerja `brone-talk` di Intel NUC.
2. Di `brone_talk.py` bagian atas, tambahkan import:
   ```python
   from viseme_generator import create_speech_payload
   ```
3. Di dalam method `say()` pada class `Speaker` (sekitar baris 1800), ubah pengiriman MQTT tepat sebelum `self.play(path)`:
   ```python
   # Ganti: self.telemetry.expression("speaking", duration_s)
   # Menjadi:
   payload = create_speech_payload(expression, duration_s, text)
   self.telemetry.publish("robot/expression", payload)
   ```

*(Lihat contoh lengkapnya di `contoh_patch_brone_talk.py`)*

---

## ✨ Fitur Baru di Sisi GUI Wajah (Jetson)
- **Ekspresi Langsung Aktif:** Begitu speaker mulai bersuara, mata robot langsung berubah ke emosi jawaban (`happy`, `sad`, dll) dan mulut langsung bergerak sinkron.
- **Post-Speech Emotion Hold (Jeda Alami):** Setelah robot selesai bicara, ekspresi wajah **tidak langsung hilang kaku ke netral**. Wajah akan mempertahankan ekspresi tersebut selama ~4 detik.
- **Interupsi Cepat:** Jika dalam durasi jeda 4 detik tersebut ada orang yang kembali mengajak bicara, wajah langsung beralih ke ekspresi berpikir (`thinking`/`confused`) tanpa menunggu timer habis!

Jika ada pertanyaan atau butuh pengujian bersama, silakan kontak tim GUI Wajah! 🚀
