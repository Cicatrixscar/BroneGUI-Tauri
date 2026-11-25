# Implementasi Horizontal Gaze Brone dan Kesesuaiannya dengan Referensi

> Arsip evaluasi implementasi 24 November 2026. Status aktif setelah pengembangan 25 November ada di [laporan implementasi berbasis geometri](laporan-implementasi-gaze-berbasis-geometri.md). Pernyataan “belum diterapkan” dan batas sementara 20 di bawah menggambarkan snapshot lama.

Tanggal pemeriksaan: 24 November 2026.

Dokumen ini menjelaskan implementasi aktual pada working tree lokal, hubungan dengan tiga referensi penelitian, dan kesenjangan terhadap [rencana berbasis geometri](plan-horizontal-gaze-berbasis-geometri.md). Kontrak runtime dijelaskan di [CONTRACT.md](CONTRACT.md#gaze-horizontal-dari-cv). Catatan implementasi lama pada `rancangan-gaze-horizontal.md` memuat perilaku historis dan tidak dijadikan acuan angka aktif.

## 1. Kesimpulan kesesuaian

**Implementasi sekarang sesuai sebagian dengan prinsip referensi dan rencana, tetapi belum merupakan implementasi gaze berbasis geometri.** Yang sudah tersedia adalah pemisahan input CV dari render, pembatasan target internal, translasi kedua mata bersama, dan animasi yang terpisah dari kedip serta mulut.

Yang belum tersedia adalah normalisasi perpindahan terhadap dimensi mata/sklera, wilayah jangkar mata yang terukur, dan perhitungan maksimum perpindahan dari geometri. Nilai `maxOffsetX: 20` masih merupakan konfigurasi sementara untuk pengujian lokal. Tidak ada dasar untuk menyebut angka 20 sebagai hasil rumus Clotet, Fang, atau Vázquez.

Selain itu, Brone menggerakkan **gambar mata utuh**, sedangkan penelitian yang dirujuk membahas posisi pupil dalam mata atau layar mata. Karena objek yang digerakkan berbeda, implementasi ini merupakan pendekatan gaze sederhana untuk desain Brone, bukan reproduksi penuh metode penelitian tersebut.

## 2. Alur aktual dalam kode

```text
CV mengirim {"type":"gaze","x":...}, dengan X angka finite
  -> MQTT robot/gaze, tanpa retain
  -> ingress.rs: parse payload, bentuk Pesan::Gaze
  -> protocol.rs: validasi finite dan nama event brone://gaze
  -> mqtt.rs: emit event ke frontend
  -> connector.js: terapkan kebijakan mode, panggil state.setGaze(x)
  -> state.js: clamp ke [-1,1], koreksi arah, simpan target
  -> renderer.js: interpolasi target, kalikan dengan maxOffsetX
  -> SVG #layer-eyes: translate(offsetX, 0)
```

Untuk browser development, `scripts/dev-server.js` menyediakan HTTP/SSE dan memakai `src/js/gaze.js` sebagai adapter format eksternal. Jalur development dan MQTT/Tauri berbeda transportnya; kelulusan salah satunya tidak membuktikan jalur lainnya.

| Lokasi | Implementasi aktual |
|---|---|
| `src-tauri/src/connector/ingress.rs:12`, `:30` | Topik `robot/gaze`; mengubah payload eksternal menjadi `Pesan::Gaze { x }` |
| `src-tauri/src/connector/protocol.rs:82`, `:99` | Event `brone://gaze`; X wajib finite, tanpa batas rentang [-1,1] di backend |
| `src-tauri/src/connector/mqtt.rs:59` | Mengabaikan pesan gaze dengan retained flag |
| `src/js/gaze.js:2` | Adapter development: tepat dua field `type` dan `x`, X finite, nilai asli diteruskan |
| `src/js/connector.js:219` | Cabang gaze diproses terpisah sebelum lifecycle pesan LLM; memanggil `state.setGaze` jika mode mengizinkan |
| `src/js/state.js:54` | Clamp, mirroring, dan penyimpanan target; target efektif yang sama tidak mengirim notifikasi ulang |
| `src/js/renderer.js:189` | Smoothing, penahanan ekspresi khusus, reset, serta translasi layer mata |
| `src/config/config.json:170` | `invertX: true`, `maxOffsetX: 20`, `durationMs: 150`; field sensitivitas lama dihapus |
| `src/index.html:14`, `:41` | SVG viewBox 800 × 480 dan parent kedua mata `#layer-eyes` |

Nomor baris merupakan lokasi saat pemeriksaan dan dapat berubah setelah pengembangan berikutnya.

## 3. Pembatasan input dan pemetaan perpindahan

### 3.1 Kontrak CV yang disepakati

CV boleh mengirim angka finite berapa pun. Pembatasan rentang menjadi tanggung jawab GUI. Payload seperti `{"type":"gaze","x":8}` sah dan tidak ditolak hanya karena X lebih besar dari 1. String, boolean, null, dan angka nonfinite bukan input sah.

Kode aktif dalam `FaceState.setGaze()`:

```js
if (!Number.isFinite(x)) return;
const direction = this.config.gaze?.invertX === false ? 1 : -1;
const target = Math.max(-1, Math.min(1, x)) * direction;
if (this.gazeX === target) return;
this.gazeX = target;
this.notifyChange();
```

Ini adalah **clamp atau saturasi**, bukan normalisasi berdasarkan ukuran mata maupun konversi koordinat piksel kamera. Input 1, 8, dan 200 menghasilkan target efektif yang sama. CV tetap harus memberi makna yang konsisten pada nol, tanda, dan skala inputnya.

Penguatan sensitivitas 4 dari versi sebelumnya sudah dihapus. Field `gaze.sensitivity` yang masih tertinggal dalam override lokal tidak dibaca oleh `setGaze()`.

### 3.2 Konversi target ke offset SVG

`Renderer.updateGaze()` mengalikan nilai gaze hasil interpolasi dengan konfigurasi batas:

```js
const limit = this.config.gaze?.maxOffsetX;
const maxOffsetX = Number.isFinite(limit) && limit >= 0 ? limit : 20;
this.eyeLayer.setAttribute(
  'transform',
  `translate(${this.gazeCurrent * maxOffsetX} 0)`
);
```

Pada konfigurasi utama, keadaan akhir mengikuti:

```text
u = clamp(xCV, -1, 1)
direction = -1 karena invertX=true
offsetX = u × direction × 20
```

| X dari CV | Setelah clamp | Target setelah mirroring | Offset akhir SVG |
|---|---:|---:|---:|
| -5 | -1 | 1 | 20 |
| -1 | -1 | 1 | 20 |
| -0.4 | -0.4 | 0.4 | 8 |
| 0 | 0 | 0 | 0 |
| 0.4 | 0.4 | -0.4 | -8 |
| 0.5 | 0.5 | -0.5 | -10 |
| 1 | 1 | -1 | -20 |
| 8 | 1 | -1 | -20 |

Positif pada offset berarti kanan layar; negatif berarti kiri layar. Untuk kamera yang sudah mempunyai orientasi sesuai layar, `invertX:false` menghilangkan pembalikan. Koreksi arah ini adalah keputusan integrasi kamera Brone, bukan rumus dari penelitian.

## 4. Elemen visual, koordinat, dan animasi

### 4.1 Yang digerakkan adalah seluruh mata

Pada `src/index.html`, `#eye-l` dan `#eye-r` merupakan elemen `<image>` di dalam `#layer-eyes`. `MATA.svg` berisi ilustrasi mata beserta outline dan highlight, bukan pupil yang diekspos sebagai elemen DOM terpisah. Gaze menggeser parent kedua gambar. Y, ukuran gambar, dan jarak antar mata pada suatu ekspresi tidak diubah oleh gaze.

`Renderer.updateEyes()` di `src/js/renderer.js:395` tetap memilih aset, X, Y, lebar, dan tinggi sesuai ekspresi. Secara konseptual posisi akhir adalah posisi dasar ekspresi ditambah offset gaze. Offset tidak diakumulasikan setiap kali pesan CV masuk.

Satuan perpindahan adalah satuan viewBox SVG 800 × 480, bukan milimeter atau piksel fisik layar. `preserveAspectRatio="xMidYMid meet"` membuat ukuran tampilan mengikuti viewport secara proporsional. Tidak ada konversi sudut pandang, jarak target, atau koordinat 3D dalam gaze saat ini.

### 4.2 Gerak halus yang tersedia

Renderer memakai loop `requestAnimationFrame` yang sudah ada. Rumus easing aktif adalah:

```text
p = clamp((timestamp - startedAt) / durationMs, 0, 1)
eased = 1 - (1-p)^2
gazeCurrent = gazeFrom + (gazeTarget-gazeFrom) × eased
```

Default durasi adalah 150 ms. Ketika target berubah, renderer mengambil posisi saat ini sebagai titik awal berikutnya. Pesan dengan target efektif yang sama tidak memulai ulang gerakan. Tidak ada antrean tween gaze atau pengukuran geometri per frame.

Ini menjaga kontinuitas posisi pada retarget normal, tetapi tidak menjamin kontinuitas kecepatan. Durasi 150 ms dan easing kuadratik merupakan pilihan implementasi lokal; belum dibuktikan sebagai parameter optimal untuk robot dan tidak diambil sebagai hasil ketiga penelitian.

### 4.3 Kedip, ekspresi, dan lifecycle

| Kondisi | Perilaku kode sekarang | Batas kesesuaiannya |
|---|---|---|
| Kedip | Gaze menulis transform SVG pada `#layer-eyes`; kedip menulis `scaleY` pada wrapper mata melalui `triggerBlinkAnimation()` | Transform terpisah sehingga gaze tidak menimpa kedip |
| Ekspresi biasa | Aset dan pose dasar diganti oleh `updateEyes()`; offset parent tetap diterapkan | Belum ada batas berbeda atau validasi wilayah aman tiap ekspresi |
| Cry/menangis | Offset tampilan langsung dipusatkan, target terakhir tetap disimpan | Menjaga keselarasan dengan air mata dan clip path yang berada di layer terpisah; pemusatan masih dapat terlihat mendadak |
| Timeout | Offset dipusatkan, rotasi mata tetap milik ekspresi | Belum ada perhitungan swept bounds rotasi; gaze bergerak ditahan selama ekspresi ini |
| Transisi cry/timeout | Status current, target, atau state yang termasuk ekspresi khusus menahan gaze | Belum menggunakan pemusatan halus selama fase mata menutup seperti usulan rencana |
| Mulut dan viseme | Pesan gaze keluar melalui cabang connector tersendiri | Tidak menjadwalkan ulang timer emosi, viseme, atau antrean kalimat |
| Pergantian mode | `ModeManager.switchMode()` memanggil `resetGaze()`; pesan saat statis dibuang | Kembali dinamis tidak memutar ulang input yang masuk selama statis |
| Tanpa pesan baru | Target terakhir bertahan | Tidak ada timeout kehilangan target; CV perlu mengirim `x:0` untuk reset eksplisit |

## 5. Perbandingan dengan referensi penelitian

### 5.1 Rubies, Palacín, dan Clotet 2022

Sumber: *Enhancing the Sense of Attention from an Assistance Mobile Robot by Improving Eye-Gaze Contact from Its Iconic Face Displayed on a Flat Screen*, Sensors 22, 4282. [DOI](https://doi.org/10.3390/s22114282). Dokumen yang ditelaah: `sensors-22-04282-v2 (1).pdf`, bagian 3.2, Figure 3, Table 2, dan persamaan (6)–(8), halaman PDF 7–8. Penulis pertamanya adalah Elena Rubies; Clotet merupakan penulis ketiga.

Penelitian menyatakan posisi pupil relatif terhadap diameter sklera, antara lain `DL=100×pL/(sØ/2)` dan `DR=100×pR/(sØ/2)`. Nilai 100% merujuk posisi ekstrem saat hanya setengah pupil terlihat. Parameter wajah dan ukuran elemen dijelaskan secara eksplisit. Kesimpulan pada halaman PDF 20 juga menekankan kalibrasi untuk desain wajah yang digunakan dalam penelitian.

**Hubungan dengan kode Brone:** `state.js` memisahkan target relatif dari perpindahan renderer, sehingga sejalan dengan gagasan memisahkan parameter kontrol dari koordinat gambar. Namun, `clamp(x,-1,1)` tidak membagi perpindahan dengan ukuran mata atau sklera. `renderer.js` langsung mengalikan dengan 20.

**Penilaian: sesuai pada prinsip representasi relatif, belum menerapkan normalisasi geometris penelitian.** Menyamakan clamp [-1,1] dengan rumus normalisasi sklera akan keliru. Brone juga tidak menggeser pupil di dalam sklera tetap. Angka dimensi dan batas 100% dari robot penelitian tidak dapat dipakai langsung untuk mata utuh Brone.

### 5.2 Fang et al. 2024

Sumber: *Enhancing social robot's direct gaze expression through vestibulo-ocular movements*, Advanced Robotics 38(19–20), 1457–1469. [DOI](https://doi.org/10.1080/01691864.2024.2398556). Bagian 3.1.2–3.1.3, halaman PDF 6–7 / jurnal 1461–1462, menjelaskan pemetaan pupil ke layar 2D serta Eye-Only Range (EOR).

EOR ditetapkan sebagai wilayah dengan radius sudut theta. Ketika arah mata melampaui wilayah tersebut, kepala ikut bergerak. Metodenya berkaitan dengan koordinat sudut, posisi pupil, dan koordinasi mata–kepala, bukan sekadar batas perpindahan gambar dalam piksel.

**Hubungan dengan kode Brone:** clamp dan `maxOffsetX` membuat permintaan gaze mengalami saturasi pada sebuah batas. Ini serupa pada gagasan umum membatasi gerak mata. Akan tetapi, kode tidak mempunyai EOR sudut, pengukuran region, vestibulo-ocular movements, ataupun kendali kepala.

**Penilaian: adaptasi prinsip pembatasan saja, bukan implementasi EOR/VOM Fang.** Tidak mengimplementasikan kepala sesuai dengan lingkup horizontal gaze Brone, tetapi tidak membuktikan kesetaraan metode. Nilai 20 bukan hasil konversi EOR paper ke SVG Brone.

### 5.3 Vázquez 2017

Sumber: Marynel Vázquez, *Reasoning About Spatial Patterns of Human Behavior During Group Conversations with Robots*, Carnegie Mellon University, Juli 2017. Dokumen `vazquez_thesis.pdf`, bagian 7.2.2.1–7.2.2.2, halaman tercetak 57 / PDF 64, serta Appendix A, halaman tercetak 85 / PDF 92.

Pada gaze acak, perpindahan menggunakan ukuran mata: `dx=eye_width×epsilon1` dan `dy=eye_height×epsilon2`. Posisi pupil di luar batas mata dianggap invalid. Appendix A juga menjelaskan kalibrasi proyeksi lokasi dunia 3D ke posisi pupil 2D, dengan constraint posisi akhir. Kedua pupil memakai pemetaan bersama dengan garis pandang paralel.

**Hubungan dengan kode Brone:** transform parent memberi kedua mata offset horizontal yang sama. Ini sejalan secara konseptual dengan gerak bersama, walaupun yang digerakkan Brone adalah gambar mata utuh. Kode belum membaca lebar mata untuk menghitung offset, belum menguji containment terhadap region mata, dan tidak mempunyai kalibrasi 3D-ke-2D.

**Penilaian: gerak bersama sesuai secara konseptual; penskalaan dimensi dan constraint geometris belum diterapkan.** Clamp input hanya membatasi angka kontrol dan tidak membuktikan gambar tetap berada pada wilayah wajah yang benar. Gaze acak, noise, dan proyeksi 3D tidak diwajibkan untuk lingkup satu input horizontal ini.

### 5.4 Ringkasan status

| Prinsip atau metode | Status implementasi Brone |
|---|---|
| Target relatif terpisah dari koordinat render | Sudah tersedia |
| Pembatasan permintaan gaze | Sudah tersedia melalui clamp input dan pengali konfigurasi |
| Normalisasi perpindahan terhadap ukuran mata/sklera | Belum tersedia |
| Batas gerak dari geometri dan region jangkar mata | Belum tersedia |
| Gerak kedua mata bersama | Sudah tersedia untuk gambar mata utuh |
| EOR berbasis sudut dan koordinasi kepala | Tidak diterapkan; di luar lingkup fitur sekarang |
| Kalibrasi proyeksi target dunia 3D | Tidak diterapkan; input hanya satu X |
| Bukti persepsi gaze setara dengan penelitian | Belum ada evaluasi pengguna Brone |

Referensi mendukung prinsip desain, tetapi tidak menyediakan angka maksimum universal untuk wajah Brone. Kesamaan prinsip juga tidak berarti kode sebelumnya secara historis dibuat menggunakan seluruh metode penelitian tersebut.

## 6. Apakah batas 20 sudah aman secara geometri

Untuk pose netral, config menempatkan mata kiri pada X=115 dengan lebar 129, dan mata kanan pada X=556 dengan lebar 129. Maka rectangle penempatan awal adalah [115;244] dan [556;685]. Pada offset ±20, swept rectangle horizontal masing-masing menjadi [95;264] dan [536;705]. Keduanya masih di dalam lebar wajah [0;800].

Perhitungan ini membuktikan containment horizontal rectangle pose netral terhadap lebar wajah pada nilai tersebut. Perhitungan ini **tidak membuktikan** batas visual maksimal, seluruh painted extent semua aset, semua fase animasi, atau kesan mata tidak terlepas.

Pada pose netral, rasio offset maksimum terhadap lebar mata adalah `20/129 ≈ 15,50%`. Rasio ini hanya penjelasan nilai saat ini, bukan dasar pemilihan angka 20. Kode renderer juga tidak menghitung rasio ini: angka 20 tetap dibaca dari config atau fallback.

Tidak ada pengaman geometris dinamis yang mengurangi `maxOffsetX` bila config diubah terlalu besar. Sebagai contoh konsekuensi kode, menaikkan nilai tersebut melampaui ruang wajah tetap diperbolehkan selama angkanya finite dan nonnegatif. Karena itu belum tepat mengklaim “mata dijamin tidak keluar wajah untuk semua konfigurasi”.

## 7. Bukti pengujian dan batas bukti

Pada tahap implementasi sebelumnya di sesi ini, `node --test tests/fe/*.test.js` menghasilkan 66 tes lulus. Sepuluh tes gaze pada `tests/fe/gaze.test.js` mencakup penerimaan finite X, clamp ekstrem, input pecahan tanpa penguatan, mirroring, retarget, kompatibilitas transform kedip, penahanan cry/timeout, reset mode, dan isolasi timer mulut pada mode bawaan/streaming/fallback.

`scripts/verify-gaze.mjs` juga lulus melalui CLI -> HTTP -> SSE -> SVG pada browser. Artefak yang tersedia:

- [verification.json](../reports/gaze/verification.json): hasil pemetaan, input ekstrem/pecahan, dan penskalaan viewport.
- [left.png](../reports/gaze/left.png), [center.png](../reports/gaze/center.png), [right.png](../reports/gaze/right.png): tampilan pose netral pada tiga posisi.

Pemeriksaan browser mencakup kedip otomatis yang teramati, pergantian ekspresi yang diuji, cry/timeout, reset statis, isolasi mulut streaming, serta skala 400 × 240 dan 1600 × 960. Pada input 1 dan `invertX:true`, laporan mencatat `translate(-20 0)`; input 8 mencapai transform yang sama.

Hasil tersebut tidak membuktikan batas geometris seluruh aset dan transisi, kualitas perseptual pada pengguna, kapasitas frekuensi CV maksimum, atau efisiensi CPU/memory pada robot. Build/test Rust, broker MQTT nyata, dan runtime Tauri belum diverifikasi langsung pada tahap ini. Untuk penulisan dokumen ini, kode dan artefak hasil sebelumnya diperiksa kembali; tes tidak dijalankan ulang karena kode tidak diubah.

## 8. Pekerjaan berikutnya agar memenuhi rencana geometri

1. Ukur painted bounds, stroke/filter, pemetaan viewBox, dan transform setiap aset runtime. Rectangle `<image>` saja belum tentu sama dengan silhouette terlihat.
2. Definisikan dan validasi wilayah jangkar mata per ekspresi. Wilayah ini harus menjaga posisi mata tetap masuk akal, bukan hanya tetap di dalam layar.
3. Hitung interval offset dari containment seluruh mata terhadap region tersebut. Untuk interval horizontal mata `[li,ri]` dan region `[Ai,Bi]`, syaratnya adalah `Ai+mi-li ≤ dx ≤ Bi-mi-ri`, dengan margin mi yang asalnya terukur.
4. Iris interval kedua mata, ekspresi yang mendukung gaze, dan fase transisi. Dari interval global `[lower,upper]` yang memuat nol, hitung maksimum simetris `M=min(-lower,upper)`.
5. Ganti pengali sementara 20 dengan M yang tervalidasi, serta tahan gaze di tengah untuk profil geometri invalid. Input CV tetap bebas angka finite dengan clamp GUI sesuai kesepakatan terbaru.
6. Tambahkan clamp posisi akhir dan pengujian containment, termasuk jika konfigurasi/aset berubah. Rencanakan pemusatan cry/timeout yang halus sebelum efek khusus aktif.
7. Uji pada perangkat robot serta lakukan evaluasi visual/perseptual sebelum menyatakan parameter sudah sesuai untuk penggunaan akhir.

Dengan status sekarang, istilah yang tepat adalah **horizontal gaze dengan input yang dibatasi di GUI dan rentang konfigurasi sementara**. Klaim “batas gaze dihitung dari geometri sesuai referensi” baru layak setelah pengukuran region, perhitungan M, dan pengujiannya benar-benar diterapkan.
