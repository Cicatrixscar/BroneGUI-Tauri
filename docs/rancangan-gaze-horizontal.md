# Implementasi gaze horizontal

> Arsip implementasi terdahulu. Untuk perilaku aktif 25 November 2026 dan batas geometri yang dihitung otomatis, baca [laporan implementasi berbasis geometri](laporan-implementasi-gaze-berbasis-geometri.md). Semua catatan pembaruan di bawah merupakan riwayat.

> Pembaruan 24 November 2026: catatan di bawah adalah riwayat implementasi sebelumnya. Jalur aktif kini menerima semua X finite dari CV dan melakukan `clamp(x,-1,1)` di GUI, tanpa sensitivitas 4. `maxOffsetX:20` sekarang menghasilkan maksimum ±20 satuan SVG untuk pengujian lokal, belum hasil kalibrasi wilayah aman. Lihat [kontrak aktif](CONTRACT.md#gaze-horizontal-dari-cv) dan [rencana geometri](plan-horizontal-gaze-berbasis-geometri.md). Angka ±40, target ±2, dan klaim pengujian di bawah tidak menggambarkan revisi baru ini.

Status: implementasi tersedia. Jalur terminal HTTP/SSE ke browser sudah diuji; build/test Rust dan MQTT/Tauri langsung belum dijalankan karena toolchain belum tersedia.
Tanggal: 20 November 2026. Pembaruan sensitivitas: 24 November 2026.

Dokumen ini mencatat implementasi dari rancangan gaze horizontal. Kontrak aktif ada di [CONTRACT.md](CONTRACT.md). Permintaan implementasi diberikan setelah rancangan awal dan perapihan backend selesai.

## 1. Ruang lingkup

Kedua gambar mata bergeser bersama pada sumbu X. Seluruh gambar mata bergerak, bukan hanya pupil. Posisi Y, ukuran, dan bentuk mata tetap mengikuti ekspresi aktif. Mulut, viseme, antrean kalimat, serta timer ekspresi/bicara tidak dikendalikan oleh gaze.

Tidak ada gerak kepala, sumbu Y, deteksi wajah, atau gerak acak otomatis dalam fitur ini.

## 2. Kontrak CV

Topik MQTT: `robot/gaze`. Kirim tanpa retain.

```json
{"type":"gaze","x":0.5}
```

| Input x (sensitivitas 4, invertX true) | Target GUI | Geseran SVG |
|---|---|---|
| `-0.5` atau lebih negatif | `2` | `40` |
| `-0.4` | `1.6` | `32` |
| `-0.2` | `0.8` | `16` |
| `0` | `0` | `0` |
| `0.2` | `-0.8` | `-16` |
| `0.4` | `-1.6` | `-32` |
| `0.5` atau lebih positif | `-2` | `-40` |

Arah mengikuti layar yang dilihat orang di depan robot. GUI mengoreksi pencerminan kamera dengan `gaze.invertX: true` (default). Input positif menggeser mata ke kiri layar, input negatif ke kanan layar. Gunakan `invertX: false` jika CV sudah mengoreksi arahnya; jangan membalik di kedua sisi sekaligus. `x` adalah input absolut; mengirim nilai yang sama berulang tidak menambah geseran.

Payload wajib objek JSON dengan tepat dua field: `type` bernilai string `gaze`, dan `x` berupa angka finite berapa pun. Backend dan bridge meneruskan nilai asli; GUI memakai `clamp(x * sensitivity * direction, -2, 2)`. String angka, boolean, null, field hilang, field tambahan, nilai non-finite, dan JSON rusak ditolak. Target terakhir tidak berubah saat pesan invalid.

## 3. Alur implementasi

```text
CV -> MQTT robot/gaze {"type":"gaze","x":0.5}
   -> ingress.rs: parser CV dan validasi
   -> mqtt.rs: validasi kontrak internal dan emit
   -> brone://gaze {"tipe":"gaze","x":0.5}
   -> connector.js: cabang khusus gaze sebelum pemrosesan mulut
   -> FaceState.gazeX
   -> renderer: translate X pada #layer-eyes
```

Payload eksternal memakai `type`; event internal tetap memakai `tipe` seperti kontrak GUI lainnya. Subscription berasal dari `ingress::DEFAULT_TOPICS`. Adapter LLM/TTS dan format pesannya dipertahankan.

Pesan MQTT pada `robot/gaze` dengan retained flag dibuang sebelum diproses. Bridge development membaca retained flag melalui format `%r` dan menerapkan aturan yang sama khusus gaze. Perilaku retained pesan LLM/TTS tidak diubah. Referensi format: [manual resmi mosquitto_sub](https://mosquitto.org/man/mosquitto_sub-1.html).

Ini menghindari replay retained gaze saat subscription baru. Tanpa timestamp, GUI tidak dapat membuktikan usia semua pesan. Versi awal mengasumsikan satu pengirim gaze aktif.

## 4. Jarak dan gerakan

Konfigurasi di `src/config/config.json`:

```json
"gaze": {
  "invertX": true,
  "sensitivity": 4,
  "maxOffsetX": 20,
  "durationMs": 150
}
```

Angka tersebut adalah nilai awal kalibrasi. `sensitivity` mengalikan input CV sebelum dibatasi ke [-2, 2]; nilainya wajib angka finite positif, nilai hilang/invalid memakai 4. Naikkan ke 6 jika masih kurang terasa atau turunkan ke 2 jika terlalu peka. `maxOffsetX` adalah jarak per satu unit target (nama config lama dipertahankan), menggunakan satuan SVG pada viewBox dasar `800 x 480`, bukan piksel fisik layar. `durationMs` mengatur durasi lokal dengan easing ease-out kuadratik; tidak perlu menambah durasi dalam payload CV.

```text
direction = invertX ? -1 : 1
targetGaze = clamp(xCV * sensitivity * direction, -2, 2)
offsetX = gazeTerlihat * maxOffsetX
xKiriTampil = xKiriDasarEkspresi + offsetX
xKananTampil = xKananDasarEkspresi + offsetX
```

Dengan config awal, input CV `0.2` menghasilkan target `-0.8` dan offset akhir `-16` satuan SVG; input `0.4` menghasilkan target `-1.6` dan offset `-32`. Batas maksimum geseran menjadi -40 sampai 40 satuan SVG. Jarak antar mata tetap. Resize mengikuti penskalaan SVG.

Renderer memakai loop requestAnimationFrame yang sudah ada. Target baru menggantikan target lama dari posisi gerakan saat ini; tidak ada antrean. Target yang sama tidak memulai ulang gerak. Config `durationMs: 0` membuat gerakan langsung. Nilai config hilang/invalid memakai fallback 20 satuan dan 150 ms.

Transform gaze berada pada parent `#layer-eyes`; transform kedip/transisi tetap berada pada wrapper masing-masing mata, sedangkan rotasi timeout tetap pada elemen gambar. Posisi dasar di config ekspresi tidak ditimpa.

## 5. Lifecycle

- Awal aplikasi: target dan posisi gaze `0`.
- Tanpa pesan baru: posisi bertahan. Reset dengan `x:0`; tidak ada timeout otomatis.
- Selesai bicara atau reset emosi ke idle tidak mereset gaze.
- Handler gaze tidak mengubah deduplikasi pesan LLM, timer ekspresi, timer viseme, atau antrean streaming.
- Selama `cry`/`timeout`, termasuk transisi masuk/keluar, gaze terlihat di tengah. Target terbaru tetap disimpan dan diterapkan kembali setelah keluar.
- Penahanan saat `cry` menjaga aliran air mata dan clip path tetap sejajar. Efek air mata dan rotasi timeout tidak digeser atau diubah.
- Setiap perpindahan mode statis/dinamis mereset gaze ke tengah pada frame berikutnya tanpa animasi kembali. Pesan selama statis dibuang, tidak diantre.

## 6. File yang terlibat

| File | Peran |
|---|---|
| `src-tauri/src/connector/ingress.rs` | Topik dan parser payload CV |
| `src-tauri/src/connector/protocol.rs` | Varian Gaze, validasi X, nama event |
| `src-tauri/src/connector/mqtt.rs` | Mengabaikan retained gaze |
| `src/js/gaze.js` | Adapter JSON CV untuk bridge development |
| `src/js/state.js` | Mengalikan sensitivitas dan membatasi target X ke [-2, 2] dan reset gaze |
| `src/js/connector.js` | Penerimaan event gaze tanpa lifecycle mulut |
| `src/js/renderer.js` | Gerakan horizontal parent kedua mata |
| `src/js/mode.js` | Reset gaze saat pergantian mode |
| `src/config/config.json` | Batas geser, durasi, dan daftar topik referensi |
| `scripts/dev-server.js` | HTTP/SSE dan bridge MQTT untuk browser |
| `scripts/send.js` | CLI gaze |

## 7. Uji dari terminal

Jalankan server development:

```text
node scripts/dev-server.js
```

Buka `http://localhost:3000/src/` di browser, lalu jalankan di terminal kedua:

```text
node scripts/send.js gaze -1
node scripts/send.js gaze 0
node scripts/send.js gaze 1
node scripts/send.js gaze 0.5
```

Jalankan satu per satu untuk mengamati gerak. CLI mengirim format eksternal `type` dan `x` melalui `/api/message`. Jumlah browser penerima dicetak; jika `0`, belum ada browser terhubung. Ini bukan jalur backend Rust/Tauri.

Untuk gerakan kiri-kanan berulang, gunakan script berikut pada terminal kedua. Script mengirim `x:2` dan `x:-2` bergantian; dengan `invertX:true`, urutannya kiri lalu kanan:

```text
node scripts/test-gaze.mjs
node scripts/test-gaze.mjs 700
node scripts/test-gaze.mjs 700 10
```

Default bergantian kiri/kanan setiap 1000 ms sampai Ctrl+C. Argumen pertama adalah jeda per posisi dalam milidetik; argumen kedua opsional adalah jumlah siklus (satu siklus = kiri lalu kanan). Contoh terakhir menjalankan 10 siklus dengan jeda 700 ms. Setelah selesai atau Ctrl+C, script mengirim `x:0` agar mata kembali ke tengah. Gerak tetap memakai animasi gaze GUI. Gunakan mode dinamis dengan ekspresi selain `cry`/`timeout` agar gerakan terlihat. Script memakai HTTP/SSE development, bukan MQTT.

Contoh PowerShell untuk JSON mentah:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/message -ContentType application/json -Body '{"type":"gaze","x":-0.5}'
```

Tes pembatasan: `node scripts/send.js gaze -5` bergerak ke batas kanan dan `node scripts/send.js gaze 8` ke batas kiri. Dengan sensitivitas 4, nilai `0.5` sudah mencapai batas kiri; gunakan `0.2`/`0.4` untuk memeriksa penguatan nilai CV kecil. Ini pembatasan, bukan pemetaan otomatis koordinat piksel kamera ke seluruh rentang gaze. Payload HTTP `{"type":"gaze","x":"0.5"}` atau field tambahan `y` harus menghasilkan HTTP 400.

Untuk desktop Tauri atau browser dengan Mosquitto bridge tersedia, gunakan MQTT. Contoh PowerShell, tanpa flag retain:

```powershell
'{"type":"gaze","x":-1}' | mosquitto_pub -h 127.0.0.1 -t robot/gaze -s
'{"type":"gaze","x":0}' | mosquitto_pub -h 127.0.0.1 -t robot/gaze -s
'{"type":"gaze","x":1}' | mosquitto_pub -h 127.0.0.1 -t robot/gaze -s
```

Sesuaikan host dengan broker yang dipakai GUI. `scripts/send.js` tidak mengirim MQTT. Pengirim dan subscriber harus terhubung ke broker yang sama.

## 8. Verifikasi otomatis dan batas bukti

```text
node --test tests/fe/*.test.js
node scripts/verify-gaze.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

`verify-gaze.mjs` memerlukan dev server aktif dan Chromium/Edge. Default memakai Edge Windows; override lokasi browser dengan environment `BRONE_BROWSER`. Hasil disimpan di `reports/gaze/`: screenshot kiri/tengah/kanan dan `verification.json`.

Tes frontend memeriksa validasi, interpolasi, retarget tanpa lompatan, penahanan ekspresi khusus, reset statis, dan perbandingan timing emosi/viseme dengan serta tanpa gaze pada mode bawaan, streaming, dan fallback. Tes Rust untuk format CV dan angka finite sudah ditambahkan; tes frontend memeriksa pembatasan target termasuk angka ekstrem dan target efektif berulang.

Sebanyak 66 tes frontend lulus. Uji browser melalui CLI/HTTP/SSE juga lulus, termasuk pembatasan input -5, 8, serta angka finite ekstrem ke batas GUI, gerak mata, kedip otomatis yang teramati, pergantian ekspresi, static reset, dan streaming kalimat bersamaan. Screenshot tiga posisi sudah diperiksa pada 800 x 480. Penskalaan pada 400 x 240 dan 1600 x 960 sudah diverifikasi dan dicatat pada `verification.json`. Retarget saat animasi dibuktikan dalam tes frontend deterministik.

Build/test Rust, MQTT dengan broker nyata, pengabaian retained gaze saat reconnect, serta visual Tauri/WebKitGTK belum terverifikasi pada lingkungan ini karena Cargo/Mosquitto CLI belum tersedia. Uji browser tidak menggantikan pemeriksaan tersebut.

Kalibrasi sensitivitas 24 November 2026: input CV sekitar 0.2 sampai 0.4 diperkuat 4 kali; rentang target diperlebar dari [-1, 1] menjadi [-2, 2]. Perubahan ini hanya pada pemetaan frontend, tanpa perubahan JSON atau adapter LLM/TTS. Reload browser atau restart aplikasi setelah mengubah config.

Koreksi mirroring: `invertX` aktif secara default di GUI, termasuk jika field config tidak tersedia. Set `false` untuk menonaktifkan pembalikan tanpa mengubah program CV atau format JSON. Sensitivitas, batas target, dan lifecycle gaze tetap sama.
