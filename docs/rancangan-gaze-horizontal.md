# Rancangan gaze horizontal

Status: **DRAFT — belum diimplementasikan**.
Tanggal: 20 November 2026.

Dokumen ini menyusun rencana gaze berdasarkan permintaan: kedua mata cukup bergerak pada sumbu X, dengan pesan JSON berisi `type` dan `x`. Dokumen ini tidak mengubah kontrak aktif di [CONTRACT.md](CONTRACT.md) dan bukan tanda bahwa aplikasi sudah menerima pesan gaze.

## 1. Tujuan dan batas fitur

- Mata kiri dan kanan bergeser bersama ke kiri atau kanan.
- Posisi Y, ukuran, dan bentuk mata tetap mengikuti ekspresi aktif.
- Gaze tidak mengubah mulut, viseme, status bicara, atau timer ekspresi.
- Tidak ada gerak kepala, sumbu Y, pelacakan kamera, atau gerak otomatis acak.
- Tidak ada parameter durasi, ID, maupun koordinat mata terpisah dalam pesan.

**Asumsi visual:** yang bergeser adalah seluruh gambar mata, bukan pupil di dalam mata. Saat ini mata dirender sebagai elemen SVG `<image>`; renderer belum mengontrol pupil secara terpisah. Jika maksudnya hanya pupil, rancangan aset dan render perlu dibahas ulang.

## 2. Format pesan yang diusulkan

```json
{"type":"gaze","x":0.5}
```

| Field | Isi | Makna |
|---|---|---|
| `type` | String persis `"gaze"` | Perintah gaze horizontal |
| `x` | Angka dalam rentang `-1` sampai `1` | Target posisi relatif terhadap posisi dasar mata pada ekspresi aktif |

Rentang normalisasi ini adalah **usulan**, bukan keputusan dari permintaan awal. Keuntungannya: pengirim tidak perlu mengetahui resolusi layar atau jarak geser mata dalam SVG.

### Arah koordinat

Arah mengikuti **layar yang dilihat orang di depan robot**:

| Pesan | Hasil |
|---|---|
| `{"type":"gaze","x":-1}` | Kedua mata ke batas kiri layar |
| `{"type":"gaze","x":-0.5}` | Kedua mata setengah jalan ke kiri |
| `{"type":"gaze","x":0}` | Kembali ke posisi dasar ekspresi aktif |
| `{"type":"gaze","x":0.5}` | Kedua mata setengah jalan ke kanan |
| `{"type":"gaze","x":1}` | Kedua mata ke batas kanan layar |

`x` adalah target absolut yang dinormalisasi, bukan tambahan geseran. Mengirim `x:0.5` dua kali tidak membuat mata bergeser dua kali lebih jauh. Arah positif kedua mata sama; mata tidak bergerak saling mendekat atau menjauh.

Jika sumbernya kamera, modul pengirim bertanggung jawab memetakan koordinat kamera ke arah layar. GUI tidak otomatis membalik arah untuk kamera yang dicerminkan.

### Validasi yang diusulkan

- Payload wajib berupa objek JSON dengan dua field tersebut.
- `type` harus `"gaze"`; `x` wajib angka finite dalam rentang `[-1, 1]`.
- String seperti `"0.5"`, boolean, `null`, field hilang, dan JSON rusak ditolak.
- Nilai di luar rentang ditolak, bukan diam-diam dibatasi, agar kesalahan pemetaan pengirim terlihat.
- Field tambahan ditolak untuk pesan gaze versi awal; aturan pesan lain tidak ikut berubah.
- Pesan tidak valid dicatat di backend dan tidak mengubah target terakhir.

## 3. Jalur pesan dan kompatibilitas

Usulan topik MQTT: **`robot/gaze`**. Usulan event Tauri: **`brone://gaze`**. Keduanya belum tersedia saat dokumen ini dibuat.

```text
Pengirim
  -> MQTT robot/gaze: {"type":"gaze","x":0.5}
  -> backend: parsing dan validasi
  -> event brone://gaze: {"tipe":"gaze","x":0.5}
  -> state gaze di frontend
  -> renderer menggeser kedua mata
```

Format eksternal tetap memakai **`type`** sesuai permintaan. Kontrak internal yang ada memakai **`tipe`** (`#[serde(tag = "tipe")]` pada enum `Pesan`), sehingga usulan adapter menerjemahkan `type` ke `tipe` khusus gaze. Tidak perlu mengganti format ekspresi, bicara, word, atau viseme yang sudah berjalan.

Sebelum implementasi, format eksternal, pemetaan internal, topik, event, dan validasinya harus dimasukkan ke `docs/CONTRACT.md` terlebih dahulu sesuai aturan PRD.

## 4. Cara menghitung posisi mata

Gunakan posisi dasar mata dari konfigurasi ekspresi yang sedang ditampilkan:

```text
offsetX = gazeX * maxOffsetX
xKiriTampil = xKiriDasarEkspresi + offsetX
xKananTampil = xKananDasarEkspresi + offsetX
```

`maxOffsetX` adalah konfigurasi lokal GUI dalam satuan SVG pada viewBox dasar `800 x 480`, bukan piksel fisik layar. Nilainya **TBD**, ditentukan lewat pemeriksaan visual. Jarak geser yang sama menjaga jarak antar kedua mata tetap.

Contoh hitung saja, bukan nilai konfigurasi yang disetujui: jika batas geser 20 satuan SVG dan pesan `x:0.5`, kedua mata bergeser 10 satuan ke kanan.

Posisi dasar tidak boleh ditimpa atau ditambah berulang kali. Saat ekspresi berganti, gunakan posisi dasar ekspresi baru dengan offset gaze yang sama. Resize layar mengikuti penskalaan SVG sehingga arah dan proporsi gerakan tetap konsisten.

## 5. Perilaku gerakan yang diusulkan

- Saat aplikasi mulai, target dan posisi gaze adalah `0`.
- Mata bergerak halus menuju target. Durasi gerak lokal **TBD**; pengirim tetap cukup mengirim `type` dan `x`.
- Pesan terbaru menggantikan target sebelumnya. Gerakan berikutnya dimulai dari posisi yang sedang terlihat, tanpa antrean gerakan lama.
- Mengulang target yang sama tidak memulai ulang animasi.
- Tanpa pesan baru, mata tetap pada target terakhir. Kembali ke tengah dilakukan dengan `{"type":"gaze","x":0}`.
- Tidak ada timeout kembali ke tengah pada versi awal. Konsekuensinya, pengirim yang berhenti mendadak dapat meninggalkan gaze di samping.
- Gaze tetap bisa berubah saat robot berbicara; selesai bicara atau reset ekspresi ke idle tidak otomatis mereset gaze.
- Di mode statis, pesan gaze dibuang tanpa antrean, mengikuti aturan pesan connector yang ada. Usulan masuk mode statis mereset gaze ke tengah; kembali ke dinamis mulai dari tengah sampai ada pesan baru.

Untuk MQTT, usulan pesan gaze dikirim tanpa retain dan langganan baru tidak menerapkan retained gaze lama. Ini menghindari posisi sesi sebelumnya muncul saat aplikasi tersambung kembali. Tanpa timestamp, GUI tetap tidak dapat membuktikan usia semua pesan; kebijakan ini tidak menjamin urutan pesan lintas banyak pengirim. Versi awal mengasumsikan satu pengirim aktif.

## 6. Integrasi dengan render yang ada

Kondisi yang ditemukan pada repo saat dokumen dibuat:

- `src/index.html`: kedua mata berada dalam `#layer-eyes`, masing-masing memiliki wrapper kedip.
- `src/js/renderer.js`: `updateEyes()` mengatur aset dan posisi dasar mata per ekspresi.
- Kedip, fallback kedip, dan transisi ekspresi memakai transform pada `#eye-l-wrap` serta `#eye-r-wrap`; akhir transisi juga membersihkan transform wrapper.
- Ekspresi `timeout` memakai transform rotasi pada elemen gambar mata.
- Air mata dan clip path berada pada layer tersendiri dengan koordinat tetap.
- `src/js/state.js` belum memiliki state gaze dan enum pesan backend belum memiliki varian gaze.

Usulan paling kecil: gunakan translasi X pada parent `#layer-eyes`, sementara wrapper masing-masing mata tetap menangani kedip dan elemen gambar menangani rotasi. Dengan demikian offset gaze tidak perlu ditulis ke transform yang sedang dipakai animasi lain. `updateEyes()` tetap mengatur posisi dasar ekspresi.

Gerakan gaze diperbarui melalui loop render yang sudah ada. Tidak perlu loop render kedua atau dependensi baru.

**Kasus visual yang perlu keputusan:** jika mata pada ekspresi `cry` bergeser sementara air mata dan clip path diam, alirannya dapat terlepas dari mata. Usulan versi awal menampilkan gaze di tengah selama `cry` dan `timeout`, tetapi tetap menyimpan target terbaru. Setelah keluar dari ekspresi tersebut, gerak dimulai dari posisi tengah menuju target tersimpan. Ini pilihan desain sementara, bukan batas teknis yang sudah diputuskan. Jangan menggeser air mata atau mengubah rotasi tanpa persetujuan desain.

## 7. Urutan implementasi nanti

Bagian ini rencana kerja; belum ada perubahan kode.

1. Putuskan poin terbuka di bagian 9, lalu perbarui `docs/CONTRACT.md`.
2. Tambahkan parsing, validasi, dan model pesan gaze di `src-tauri/src/connector/protocol.rs`.
3. Tambahkan langganan topik dan pemetaan event pada `src-tauri/src/connector/mqtt.rs`, serta daftar topik konfigurasi yang dipakai.
4. Tambahkan target gaze di `src/js/state.js` dan penerimaan event di `src/js/connector.js`; penerimaan gaze tidak menyentuh lifecycle bicara atau emosi.
5. Tambahkan konfigurasi jarak/durasi lokal dan translasi parent mata di `src/js/renderer.js`.
6. Sesuaikan bridge `scripts/dev-server.js` untuk jalur uji browser dengan semantik yang sama. Endpoint generik `/api/message` bisa dipakai; endpoint baru tidak diperlukan.
7. Uji kontrak backend dan hasil visual, termasuk kedip serta pergantian ekspresi.

## 8. Kriteria penerimaan

| Skenario | Hasil yang harus terlihat |
|---|---|
| `x:-1`, `x:0`, `x:1` | Kedua mata bergerak bersama ke kiri, dasar, dan kanan sesuai batas lokal |
| `x:0.5` berulang | Target tetap, tidak terjadi akumulasi geseran atau restart animasi |
| Target kanan lalu kiri saat masih bergerak | Gerakan berlanjut dari posisi terlihat menuju target terbaru |
| Kedip saat gaze menyamping | Mata menutup dan membuka tanpa kehilangan offset X |
| Ganti ekspresi saat gaze aktif | Bentuk dan posisi dasar mengikuti ekspresi baru; gaze tetap sesuai kebijakan |
| `cry` atau `timeout` | Mengikuti kebijakan khusus yang sudah diputuskan sebelum implementasi |
| Viseme dan selesai bicara | Mulut tetap bekerja; gaze tidak mengatur ulang timer bicara/ekspresi |
| Pesan rusak atau `x` di luar rentang | Ditolak backend, posisi sebelumnya tetap |
| Mode statis lalu kembali dinamis | Pesan selama statis tidak dimainkan ulang |
| Resize dan target ekstrem | Gerakan proporsional; mata tidak terpotong atau menabrak elemen wajah |
| Sambung ulang MQTT | Tidak menerapkan retained gaze lama |

Tes backend harus mencakup tiap aturan validasi, termasuk angka batas dan desimal. Pemeriksaan visual dilakukan melalui jalur browser dan Tauri; uji unit saja tidak membuktikan transform kedip dan gaze cocok.

## 9. Poin yang perlu diputuskan

Permintaan yang sudah jelas: **hanya gerakan X kedua mata dan payload eksternal dua field, `type` serta `x`**.

Detail berikut masih usulan dalam dokumen ini:

- Seluruh gambar mata yang digeser, bukan hanya pupil.
- `x` dinormalisasi `[-1, 1]`, positif ke kanan layar.
- Topik `robot/gaze`, event `brone://gaze`, dan adapter internal memakai `tipe`.
- Batas jarak geser dan durasi penghalusan lokal: **TBD setelah uji visual**.
- Posisi bertahan sampai ada pesan berikutnya; pengirim mengirim `x:0` untuk reset.
- Reset saat masuk mode statis dan kebijakan tanpa retained gaze.
- Penangguhan visual gaze selama `cry` dan `timeout`.

Dokumen ini tidak mengizinkan implementasi otomatis. Kode baru dikerjakan setelah diminta.
