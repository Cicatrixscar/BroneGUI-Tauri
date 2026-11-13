# PRD: GUI Wajah Brone

Versi: 1.2 (draft). Perubahan: parameter offset viseme ditambahkan (Q28, usulan dari pembimbing). Perubahan: Q2 sampai Q6, Q9 sampai Q11, dan Q25 sampai Q26 diputuskan atau ditutup. Efek dianimasikan (F-09). Idle tanpa timeout (F-08). Q1 diputuskan: MQTT. Q7, Q8, Q25, Q26, Q27 terbuka.
Status: Q1 diputuskan (MQTT). Q7, Q8, Q25, Q26, dan Q27 masih terbuka (lihat bagian 12). Sisanya sudah diputuskan atau ditutup.
Pemilik: Tim GUI Brone

Catatan untuk agent: dokumen ini mendefinisikan apa yang dibangun dan bagaimana menguji hasilnya. Nilai yang ditandai TBD atau DRAFT belum disepakati. Jangan mengisinya dengan angka tebakan. Tanyakan atau tandai sebagai asumsi.

---

## 1. Ringkasan

GUI Brone adalah wajah 2D robot yang ditampilkan di monitor. Wajah ini menampilkan ekspresi dan gerakan mulut (viseme) yang sinkron dengan suara. Aplikasi dibangun dengan Tauri dan berjalan di Intel NUC dengan Linux (Ubuntu).

GUI hanya bertugas menampilkan. Pemrosesan bahasa (LLM), suara (STT dan TTS), dan penglihatan (kamera) dikerjakan modul lain. GUI menerima pesan dari modul tersebut lewat connector dan menampilkannya.

## 2. Tujuan

1. Wajah tampil di monitor secara halus, tanpa patah-patah, dalam kondisi idle maupun saat menerima pesan.
2. Ekspresi berubah secara bertahap, bukan langsung berganti.
3. Mulut bergerak sesuai jadwal viseme yang dikirim dari modul suara.
4. Aplikasi stabil berjalan lama tanpa intervensi.
5. Performa (memori, CPU, FPS) terukur di NUC dengan metode yang bisa diulang.
6. Operator bisa memilih ekspresi dan viseme secara manual untuk memeriksa bentuk wajah, tanpa menunggu pesan dari modul lain.

Bukan tujuan saat ini: wajah 3D, deteksi wajah pengguna, pemrosesan bahasa, atau sintesis suara.

## 3. Ruang lingkup

### 3.1 Termasuk (in scope)

- Render wajah 2D di satu canvas fullscreen.
- Daftar ekspresi dan transisi antar ekspresi.
- Kedip otomatis.
- Viseme dan sinkronisasi bibir berdasarkan jadwal waktu.
- Connector di backend Rust yang menerima pesan, memvalidasi, dan meneruskannya ke frontend.
- Konfigurasi tampilan lewat file.
- Mode benchmark (FPS dan log latensi).
- Jalan fullscreen tanpa dekorasi jendela, dan autostart saat boot.
- Dua mode: mode dinamis (menerima pesan dari connector) dan mode statis (operator memilih ekspresi dan viseme secara manual).

### 3.2 Tidak termasuk (out of scope)

- LLM, STT, TTS, dan logika percakapan. Tim lain.
- Deteksi wajah pengguna, klasifikasi emosi dari kamera. Tim vision.
- Konversi fonem ke viseme dari teks atau audio. Diputuskan di luar GUI (lihat pertanyaan terbuka).
- Wajah 3D, animasi tubuh, gestur tangan.
- Penyimpanan data pengguna atau akun.
- Dukungan multi-monitor.
- Dukungan platform selain Linux.

## 4. Pengguna dan skenario

Pengguna langsung GUI adalah orang yang berinteraksi dengan robot. Operator atau pengembang adalah orang yang memasang dan mengonfigurasi aplikasi.

| ID | Skenario | Hasil yang diharapkan |
|---|---|---|
| S-01 | Robot dinyalakan, tidak ada percakapan | Wajah tampil dalam ekspresi netral, berkedip acak |
| S-02 | Modul LLM mengirim ekspresi "senang" | Wajah bertransisi halus ke ekspresi senang dalam durasi yang ditentukan config |
| S-03 | Robot bicara, modul suara mengirim jadwal viseme | Mulut mengikuti viseme sesuai waktu, sinkron dengan suara |
| S-04 | Pesan rusak atau tidak sesuai kontrak | Pesan dibuang, dicatat di log, wajah tidak berubah tiba-tiba |
| S-05 | Aplikasi jalan 8 jam tanpa henti | Tidak ada crash, memori tidak terus naik |
| S-06 | Operator ingin mengukur performa | Mode benchmark menampilkan FPS dan log bisa diambil |
| S-07 | Operator ingin memeriksa bentuk wajah satu per satu | Mode statis: operator memilih ekspresi dari daftar, wajah langsung tampil tanpa menunggu pesan |
| S-08 | Operator ingin memeriksa bentuk mulut per viseme | Mode statis: operator memilih viseme, mulut langsung menampilkan bentuk tersebut dan tetap di sana |
| S-09 | Robot sedang berinteraksi, operator mencoba mode statis | Mode berpindah tanpa restart, pesan dari connector tidak mengganggu pemeriksaan (lihat F-16) |

## 5. Arsitektur

```
Modul LLM / suara  --(pesan JSON)-->  CONNECTOR (Rust, src-tauri)  --(event Tauri)-->  FRONTEND (JS, src)
                                       validasi, log                                   state -> interpolator -> renderer
```

- Frontend (`src/`): semua logika tampilan. Berjalan di WebKitGTK melalui Tauri.
- Backend (`src-tauri/`): hanya connector. Tidak menggambar apa pun.
- Kontrak pesan: `docs/CONTRACT.md`. Kedua sisi hanya bertemu lewat kontrak ini.
- Transport dari modul LLM ke connector: MQTT. LLM publish ke `robot/expression` dan `robot/voice_stage`; backend GUI menerjemahkan ke kontrak internal (diputuskan lewat audit 11 November 2026, lihat `docs/CONTRACT.md`).

## 6. Fitur detail

Prioritas: P0 wajib untuk rilis pertama. P1 penting, bisa setelah P0. P2 opsional.

### F-01: Render wajah 2D (P0)

Deskripsi: wajah digambar di satu `<canvas>` yang mengisi seluruh layar. Wajah dibentuk dari parameter (bukan gambar statis per ekspresi), sehingga bisa diinterpolasi.

Parameter wajah minimum:
- Mata kiri dan kanan: tinggi, lebar, kemiringan kelopak, squint (0 sampai 1), highlight tampil atau tidak.
- Mulut: keterbukaan (0 sampai 1), kelengkungan (-1 sampai 1), lebar.
- Alis: TBD, belum ada di desain yang ditetapkan. Jangan diimplementasikan sebelum ada keputusan.
- Efek: air mata, tanda seru, tanda tanya (lihat F-09).

Desain acuan: gambar ekspresi dari tim desain (Base, Happy, Happier, Sad, Cry, Shock, Confused). Nilai parameter per ekspresi diturunkan dari gambar, dan disimpan di file config, bukan di kode.

Acceptance criteria:
- AC-01.1: Canvas mengisi seluruh area jendela pada resolusi 800x480 (rasio 5:3) tanpa scrollbar.
- AC-01.2: Wajah tetap proporsional saat ukuran jendela berubah.
- AC-01.3: Warna latar `#CBD8E2` (diputuskan). Warna wajah mengikuti file desain.
- AC-01.4: Render berjalan lewat `requestAnimationFrame`, bukan `setInterval`.

### F-02: Daftar ekspresi (P0)

Deskripsi: tujuh ekspresi dasar. Nama mengikuti kontrak.

| Nama (kontrak) | Nama desain | Ringkas |
|---|---|---|
| `netral` | Base | Mata oval, mulut senyum terbuka |
| `berpikir` | Confused | Satu mata lebih kecil, mulut datar miring, tanda tanya |
| `sedih` | Sad | Kelopak miring, mulut melengkung ke bawah |
| `menangis` | Cry | Air mata, mulut melengkung ke bawah |
| `terkejut` | Shock | Dua tanda seru, mulut bulat terbuka |
| `senang` | Happy (BRONE_FACE_HAPPY) | Mata normal, mulut terbuka besar. Tanpa blush |
| `sangat_senang` | Happier (BRONE_FACE_HAPPIER) | Mata kecil dengan blush merah muda, mulut terbuka |

Pemetaan gambar referensi (dari Brone_Face.zip, folder `expression/`):

| File | Nama kontrak | Status |
|---|---|---|
| BRONE_FACE_BASE.png | `netral` | Pasti |
| BRONE_FACE_THINKING.png | `berpikir` | Pasti |
| BRONE_FACE_SAD.png | `sedih` | Pasti |
| BRONE_FACE_CRY.png | `menangis` | Pasti |
| BRONE_FACE_SHOCK.png | `terkejut` | Pasti |
| BRONE_FACE_HAPPY.png | `senang` | Pasti (Q20) |
| BRONE_FACE_HAPPIER.png | `sangat_senang` | Pasti (Q20) |
| BRONE_FACE_HAPPIER (TRANSITION).png | `sangat_senang_transisi` (Q23) | Ekspresi transisi sesaat. Dipakai hanya sebentar, misalnya saat robot mengucapkan "Halo" (Q20) |

Catatan (Q20, diputuskan):
- HAPPY = `senang`, HAPPIER = `sangat_senang`.
- HAPPIER (TRANSITION) bukan ekspresi tetap. Ia dipakai sesaat, misalnya saat robot mengucapkan "Halo". Setelah durasi selesai, wajah kembali ke `sangat_senang` (Q23). Ekspresi ini tidak masuk daftar 7 ekspresi tetap, dan tidak dipanggil lewat `emosi` biasa.

Acceptance criteria:
- AC-02.1: Setiap nama di atas ada di config dengan nilai parameter lengkap.
- AC-02.2: Nama di luar daftar dianggap tidak valid (lihat F-10).
- AC-02.3: Gambar acuan memakai BRONE_FACE_HAPPY dan BRONE_FACE_HAPPIER. Tidak ada HAPPY1 (diputuskan, Q5).

### F-03: Transisi antar ekspresi (P0)

Deskripsi: perubahan dari satu ekspresi ke ekspresi lain berlangsung bertahap lewat interpolasi linear (atau easing) setiap parameter.

Parameter config (nilai default TBD, bisa diubah tanpa rebuild):
- `transisi_ms_default`: durasi transisi jika pesan tidak menyebut durasi. Usulan 400 ms, perlu persetujuan.
- `easing`: nama fungsi easing.

Aturan:
- Pesan baru saat transisi sedang berjalan: transisi baru dimulai dari posisi parameter saat ini, bukan dari awal ekspresi sebelumnya.
- Intensitas (0 sampai 1) mengalikan selisih antara ekspresi target dan netral.

Acceptance criteria:
- AC-03.1: Tidak ada lompatan frame pada parameter saat transisi (perubahan per frame dibatasi easing).
- AC-03.2: Pesan kedua yang datang di tengah transisi tidak membuat wajah kembali ke posisi awal.
- AC-03.3: Intensitas 0 menampilkan netral, intensitas 1 menampilkan ekspresi penuh.

### F-04: Kedip otomatis (P0)

Deskripsi: mata berkedip dengan interval acak. Kedip hanya mengubah tinggi mata dalam waktu singkat, lalu kembali.

Parameter config (disetujui):
- `kedip_interval_min_ms`: 3000
- `kedip_interval_max_ms`: 6000
- `kedip_durasi_ms`: usulan 150 ms, perlu persetujuan.

Aturan: kedip tetap berjalan saat ekspresi berubah. Kedip tidak boleh memutus transisi ekspresi.

Acceptance criteria:
- AC-04.1: Interval antar kedip berada dalam rentang config.
- AC-04.2: Kedip tidak terjadi saat ekspresi sedang berada di transisi (TBD, cek dengan tim desain).

### F-05: Menerima ekspresi dari connector (P0)

Deskripsi: BE mengirim pesan ekspresi ke FE lewat event Tauri. FE memperbarui state.

Event (DRAFT): `brone://ekspresi`. Payload sesuai `docs/CONTRACT.md`.

Acceptance criteria:
- AC-05.1: Pesan ekspresi valid mengubah state dan memulai transisi dalam 1 frame setelah event diterima.
- AC-05.2: Latensi dari pesan masuk ke connector sampai transisi dimulai dicatat di log (lihat F-11).

### F-06: Viseme dan jadwal bicara (P0)

Deskripsi: modul suara mengirim jadwal viseme. Setiap item berisi waktu `t` (detik relatif terhadap awal audio) dan nama viseme `v`. FE memilih viseme aktif berdasarkan waktu audio.

Viseme yang didukung (DRAFT, sesuai kontrak): `P_B_M`, `TH`, `N_L`, `T_D`, `F_V`, `K`, `C_J_SY`, `S_Z`, `R`, `A`, `E`, `I_G`, `O`, `U`, `DIAM`.

Pemetaan gambar referensi (dari Brone_Face.zip, folder `viseme/`):

| File | Viseme | Catatan |
|---|---|---|
| VISEME_A.png | `A` | |
| VISEME_E.png | `E` | |
| VISEME_I.png | `I_G` | G ikut ke kelompok I (Q21, diputuskan) |
| VISEME_O.png | `O` | |
| VISEME_U.png | `U` | |
| VISEME_C, J, S, Y.png | `C_J_SY` | |
| VISEME_K.png | `K` | K saja. Tidak ada G di sini (Q21) |
| VISEME_N.png | `N_L` | N. L ikut ke kelompok N (Q21, dikonfirmasi) |
| VISEME_R.png | `R` | |
| VISEME_S,Z.png | `S_Z` | |
| VISEME_T,D.png | `T_D` | |
| VISEME_TH.png | `TH` | |
| VISEME_TH-1.png | `F_V` | Gambar F dan V |
| VISIME_P, B, M.png | `P_B_M` | Nama file tertulis VISIME (salah ketik) |
| BRONE_FACE_BASE.png (mulut) | `DIAM` | Mulut diam memakai mulut dari ekspresi `netral` (Q22, dikonfirmasi) |

Nama file di folder referensi tidak dipakai langsung di kode. Setelah dirapikan, nama file harus memakai pola `viseme_<nama>.png` tanpa koma, spasi, atau tanda kurung.

Sumber jadwal (diputuskan, Q2 dan Q3): tim LLM yang membuat JSON viseme beserta timestamp. Timestamp adalah saat audio mulai diputar. GUI tidak mengubah fonem menjadi viseme.

Parameter config (Q28): `offset_viseme_ms`. Digeser dari waktu audio sebelum memilih viseme aktif. Nilai awal 0. Diukur dengan tes sinkronisasi di NUC, bukan ditebak. Usulan pembimbing agar mulut sedikit lebih dulu bergerak tidak diterapkan sebagai geseran 1 detik, karena itu jauh di luar toleransi lip-sync.

Aturan:
- Viseme aktif adalah item dengan `t` terbesar yang masih lebih kecil atau sama dengan waktu audio saat ini.
- Viseme `DIAM` berarti mulut tertutup atau netral.
- Mulut digambar berdasarkan parameter viseme (bentuk per viseme ada di config).
- Jika jadwal kosong atau habis, mulut kembali ke `DIAM`.

Acceptance criteria:
- AC-06.1: Viseme berubah pada waktu yang sama dengan `t` dalam toleransi ±50 ms (usulan, perlu persetujuan).
- AC-06.2: Item yang `t`-nya sudah lewat saat diterima dilewati, tidak dimainkan mundur.
- AC-06.3: Viseme `P_B_M` menampilkan mulut tertutup rapat.

Catatan: waktu audio harus disediakan oleh sumber audio atau connector. Bagaimana sumber waktu ini dikirim belum diputuskan (lihat bagian 12).

### F-07: Sinkronisasi bicara (P0)

Deskripsi: pesan `bicara` menandai awal dan akhir bicara. Selama bicara, mulut mengikuti viseme dan wajah tetap pada ekspresinya. Setelah selesai, mulut kembali ke `DIAM`.

Acceptance criteria:
- AC-07.1: Pesan `bicara` dengan status `mulai` mengaktifkan mode bicara.
- AC-07.2: Pesan `bicara` dengan status `selesai` menghentikan mode bicara dan mengembalikan mulut ke `DIAM` dalam 1 frame.
- AC-07.3: Jika `selesai` tidak pernah datang, mode bicara berakhir setelah 10 detik sejak viseme terakhir (usulan, perlu persetujuan).

### F-08: Idle (P0)

Deskripsi: idle adalah ekspresi `netral`. Setelah `durasi_ms` sebuah ekspresi habis, wajah kembali ke `netral` (usulan, menggantikan timeout idle). Kedip tetap berjalan dan mulut tertutup (`DIAM`).

Acceptance criteria:
- AC-08.1: Tidak ada perubahan ekspresi tanpa pesan.
- AC-08.2: Saat idle, render tetap berjalan dan kedip tetap terjadi.

### F-09: Efek animasi (P0, diputuskan Q4)

Deskripsi: efek yang menempel pada ekspresi tertentu. Efek dianimasikan, tidak statis:
- Air mata (ekspresi `menangis`): mengalir terus selama ekspresi aktif, dengan gerakan mengalir ke bawah.
- Tanda seru (ekspresi `terkejut`): masuk dengan animasi, dan keluar dengan animasi saat ekspresi berganti.
- Tanda tanya (ekspresi `berpikir`): masuk dengan animasi, dan keluar dengan animasi saat ekspresi berganti.

Pemetaan efek ke ekspresi diturunkan dari gambar desain (BRONE_FACE_CRY, BRONE_FACE_SHOCK, BRONE_FACE_THINKING). Tidak ada field efek terpisah di kontrak.

Acceptance criteria:
- AC-09.1: Air mata terus bergerak selama `menangis` aktif, dan berhenti dengan animasi ketika ekspresi berganti.
- AC-09.2: Tanda seru dan tanda tanya masuk dengan animasi saat ekspresinya aktif.
- AC-09.3: Saat ekspresi berganti, tanda seru atau tanda tanya keluar dengan animasi sebelum atau bersamaan dengan transisi wajah.
- AC-09.4: Efek tidak muncul di ekspresi yang tidak memilikinya.

### F-10: Validasi pesan dan penanganan error (P0)

Deskripsi: BE memvalidasi setiap pesan sebelum diteruskan ke FE.

Aturan validasi (dari kontrak):
- `intensitas` harus 0.0 sampai 1.0.
- `emosi` harus salah satu nama di F-02.
- `jadwal` harus berupa daftar dengan minimal satu item, `t` tidak negatif, `v` ada di daftar viseme.
- `status` pada pesan bicara harus `mulai` atau `selesai`.

Pesan yang tidak valid:
- Dibuang, tidak diteruskan ke FE.
- Dicatat di log dengan alasan.
- Tidak menghentikan aplikasi.

Acceptance criteria:
- AC-10.1: Setiap jenis pesan tidak valid dicatat dengan alasan yang jelas.
- AC-10.2: Pesan JSON yang rusak tidak membuat aplikasi keluar.
- AC-10.3: Ada tes unit untuk setiap aturan validasi di BE.

### F-11: Logging dan metrik (P0)

Deskripsi: aplikasi mencatat peristiwa penting ke log, dan mengukur FPS serta latensi.

Yang dicatat:
- Setiap pesan masuk: waktu terima, jenis, hasil validasi.
- Latensi dari pesan masuk di BE sampai transisi dimulai di FE.
- Nilai FPS per detik (dihitung dari jumlah frame).

Format: log teks, satu baris per peristiwa, dengan timestamp. Lokasi log: `~/.local/state/brone/logs/` (usulan, Q27). Log dipakai untuk debugging, bukti hasil benchmark, dan catatan percobaan password (tanpa menyimpan password).

Acceptance criteria:
- AC-11.1: Log bisa diambil tanpa mengubah kode.
- AC-11.2: FPS dihitung dan bisa ditampilkan atau dicatat.
- AC-11.3: Log tidak tumbuh tanpa batas. Usulan: 10 MB per file, maksimal 5 file (perlu persetujuan).

### F-12: Mode benchmark (P1)

Deskripsi: mode yang bisa diaktifkan dengan argumen atau config. Menampilkan FPS di pojok layar dan mencatat ke file CSV.

Acceptance criteria:
- AC-12.1: Mode benchmark tidak aktif secara default.
- AC-12.2: Hasil benchmark bisa dibaca oleh `benchmark/sample_resources.sh` (RAM dan CPU) bersama FPS dari log.
- AC-12.3: Metode mengikuti `docs/BENCHMARK.md`.

### F-13: Fullscreen, kiosk, dan autostart (P0)

Deskripsi: aplikasi berjalan fullscreen tanpa dekorasi jendela. Dijalankan otomatis saat sistem menyala.

Acceptance criteria:
- AC-13.1: Jendela tanpa bilah judul. Aplikasi bisa keluar dengan tombol `Esc` (diputuskan, Q9).
- AC-13.2: Aplikasi berjalan otomatis setelah reboot, di session yang sama dengan robot (menunggu Q8: X11 atau Wayland).
- AC-13.3: Aplikasi tidak mengambil fokus dari aplikasi lain saat start (TBD).

### F-14: Konfigurasi (P0)

Deskripsi: semua nilai yang bisa berubah (durasi transisi, interval kedip, parameter ekspresi, parameter viseme, warna) disimpan di satu file config, bukan di kode.

Format file: JSON (diputuskan). Lokasi: di dalam repo, dibaca saat start.

Acceptance criteria:
- AC-14.1: Mengubah nilai di config dan menjalankan ulang aplikasi tanpa build ulang.
- AC-14.2: Config yang rusak membuat aplikasi memakai nilai default dan mencatat peringatan.

### F-15: Skala ke resolusi monitor (P1)

Deskripsi: wajah menyesuaikan skala dengan resolusi monitor (800x480 rasio 5:3 sebagai acuan).

Acceptance criteria:
- AC-15.1: Wajah tampil proporsional pada resolusi acuan 800x480 (rasio 5:3) maupun resolusi lain.
- AC-15.2: Rasio gambar desain dan layar adalah 5:3 (800x480, proporsional dengan aset 3200x1920). Cara menyesuaikan jika rasio berbeda: dipusatkan dengan letterbox/contain tanpa distorsi.

### F-16: Pemilihan mode (P0)

Deskripsi: aplikasi punya dua mode yang bisa dipilih.
- Mode dinamis: dipakai saat robot berinteraksi. Ekspresi dan viseme datang dari connector (F-05, F-06, F-07).
- Mode statis: dipakai operator untuk memeriksa bentuk wajah. Ekspresi dan viseme dipilih manual dari panel (F-17).

Aturan:
- Mode default saat start: dinamis. Mode statis nonaktif secara default (`mode_statis_aktif: false` di config).
- Mode bisa diganti saat aplikasi berjalan, tanpa restart.
- Indikator mode terlihat di layar hanya saat operator membuka panel (lihat F-17). Pada kondisi interaksi normal, tidak ada teks mode di wajah.
- Perpindahan mode dicatat di log (F-11).

Cara pindah mode (diputuskan, Q12 dan Q15): tombol `F2` membuka dialog password. Setelah password benar, `F2` menghidupkan atau mematikan mode statis.

Aturan password (diputuskan, Q15):
- Dialog password hanya meminta input. Verifikasi dilakukan di backend Rust (`src-tauri/src/security/`), bukan di JavaScript. Alasannya, kode JavaScript di WebView bisa dibaca dari luar.
- Password tidak pernah disimpan dalam bentuk teks biasa. Yang disimpan adalah hash (usulan: Argon2id, atau bcrypt jika Argon2 sulit dipasang).
- File hash disimpan di luar repo (misalnya `/etc/brone/secret` atau `~/.config/brone/`), dengan izin file hanya bisa dibaca pemilik. Repo hanya menyimpan path-nya di config. File ini tidak boleh masuk git.
- Pergantian password dilakukan lewat skrip terpisah, bukan lewat GUI.
- Perpindahan mode, baik aktif maupun nonaktif, sama-sama membutuhkan password.

Acceptance criteria:
- AC-16.1: Mode dapat diganti dari dinamis ke statis dan sebaliknya tanpa restart.
- AC-16.2: Perpindahan mode terjadi dalam 1 frame setelah perintah diterima.
- AC-16.3: Setiap perpindahan tercatat di log dengan timestamp dan mode tujuan.
- AC-16.4: Mode awal mengikuti config. Jika config tidak ada atau rusak, mode default dipakai dan peringatan dicatat (sesuai AC-14.2).
- AC-16.5: Jika `mode_statis_aktif` bernilai false, mode statis tidak bisa dipilih meskipun password benar. Hanya mode dinamis yang tersedia.
- AC-16.6: Dialog password tidak menampilkan karakter yang diketik (ditampilkan sebagai titik atau bintang).
- AC-16.7: Password salah dicatat di log (tanpa mencatat password itu sendiri). Setelah 3 kali salah berturut-turut, `F2` dikunci selama 60 detik (nilai TBD, bisa diatur di config).
- AC-16.8: Saat mode statis dinonaktifkan sementara wajah sedang di mode statis, aplikasi kembali ke mode dinamis dengan keadaan idle (sesuai F-18).
- AC-16.9: Verifikasi password dilakukan di backend. Tes unit mencakup password benar, salah, dan kosong.
- AC-16.10: Jika tidak ada keyboard terdeteksi, `F2` tidak melakukan apa-apa dan aplikasi tetap berjalan normal dalam mode dinamis (diputuskan, Q16).
- AC-16.11: Jika keyboard dilepas saat dialog password terbuka, dialog ditutup dan input yang sudah diketik dibuang. Tidak ada perubahan mode.

### F-17: Mode statis, pemilihan manual (P0)

Deskripsi: di mode statis, operator memilih ekspresi atau viseme dari panel. Wajah langsung menampilkan pilihan itu dan tetap di sana sampai dipilih lagi.

Isi panel:
- Daftar ekspresi: tujuh ekspresi dari F-02. Pilihan satu klik, atau satu tombol per ekspresi.
- Daftar viseme: `P_B_M`, `TH`, `N_L`, `T_D`, `F_V`, `K`, `C_J_SY`, `S_Z`, `R`, `A`, `E`, `I_G`, `O`, `U`, `DIAM`.
- Intensitas di mode statis tetap 1.0 dan tidak bisa diubah dari panel (diputuskan, Q19).
- Indikator pilihan aktif.
- Pilihan ekspresi dan viseme dapat dikombinasikan: ekspresi tetap, mulut mengikuti viseme yang dipilih.

Aturan:
- Pilihan operator menggantikan state dari connector selama mode statis.
- Transisi (F-03) tetap berlaku saat berpindah pilihan ekspresi. Ini supaya gerakan transisi juga bisa diperiksa.
- Pilihan viseme bersifat tetap: mulut tidak berubah sampai operator memilih lagi. Jadwal viseme (F-06) tidak dimainkan di mode statis.
- Kedip (F-04) tetap berjalan agar operator bisa melihat perilaku idle. Ada opsi untuk mematikannya (TBD).
- Panel bisa disembunyikan agar tampilan wajah bersih untuk pemeriksaan.

Pembeda visual antara dua mode (diputuskan):
- Mode dinamis: tidak ada teks, label, atau penanda di layar selain wajah.
- Mode statis: panel tampil dengan penanda "MODE STATIS" di bagian atas, dan setiap pilihan diberi label beserta tombol keyboard-nya.

Label dan petunjuk tombol di mode statis (diputuskan):
- Setiap ekspresi ditulis dengan nomor tombolnya, misalnya `[1] netral`, `[2] berpikir`. Ekspresi yang sedang aktif diberi tanda.
- Setiap viseme ditulis dengan huruf tombolnya, misalnya `[Q] P_B_M`. Viseme yang sedang aktif diberi tanda.
- Panel menampilkan daftar tombol mode dan panel: `F2` ganti mode, `F3` sembunyikan atau tampilkan panel.

Peta tombol (usulan, menunggu konfirmasi Q19). Semua disimpan di `config/keymap.json`, sehingga bisa diubah tanpa build ulang:

| Tombol | Fungsi |
|---|---|
| `F2` | Buka dialog password, lalu ganti mode statis (F-16) |
| `F3` | Sembunyikan atau tampilkan panel (mode statis saja) |
| `1` sampai `7` | Pilih ekspresi: netral, berpikir, sedih, menangis, terkejut, senang, sangat_senang |
| `Q` `W` `E` `R` `T` `Y` `U` `I` `O` `P` `A` `S` `D` `F` `G` | Pilih viseme berurutan: P_B_M, TH, N_L, T_D, F_V, K, C_J_SY, S_Z, R, A, E, I_G, O, U, DIAM |

Tombol di luar daftar ini tidak melakukan apa-apa di mode statis. Di mode dinamis, hanya `F2` yang aktif, dan tombol lain diabaikan.

Acceptance criteria:
- AC-17.1: Setiap ekspresi dan setiap viseme bisa dipilih dari panel.
- AC-17.2: Pilihan ekspresi tampil dengan transisi sesuai F-03.
- AC-17.3: Pilihan viseme tampil langsung tanpa transisi (diputuskan, Q13). Mode statis dipakai untuk memeriksa bentuk setiap viseme.
- AC-17.4: Pesan ekspresi dan viseme dari connector tidak mengubah tampilan selama mode statis. Pesan tersebut dicatat di log lalu dibuang, tidak diantre (lihat Q14).
- AC-17.5: Panel bisa disembunyikan dan ditampilkan lagi dengan `F3`.
- AC-17.6: Setiap ekspresi dan viseme yang tampil di panel memiliki label dan tombol sesuai peta tombol.
- AC-17.7: Ekspresi dan viseme yang sedang aktif selalu ditandai di panel.
- AC-17.8: Penanda "MODE STATIS" selalu tampil selama mode statis, dan tidak tampil di mode dinamis.
- AC-17.9: Tombol yang tidak ada di peta tombol tidak mengubah tampilan di mode statis.

### F-18: Mode dinamis, perilaku saat interaksi (P0)

Deskripsi: mode dinamis menjalankan F-05, F-06, F-07, F-08, dan F-04 seperti yang dijelaskan sebelumnya. Mode ini adalah mode normal saat robot dipakai.

Aturan:
- Pesan dari connector langsung memengaruhi wajah.
- Panel F-17 tidak tampil secara default.
- Saat kembali ke mode dinamis dari statis, wajah tampil dalam keadaan idle (diputuskan, Q14), lalu menyesuaikan dengan pesan connector berikutnya.

Acceptance criteria:
- AC-18.1: Semua acceptance criteria F-05 sampai F-08 tetap terpenuhi di mode dinamis.
- AC-18.2: Tidak ada elemen panel, teks, atau penanda mode yang terlihat di layar tanpa aksi operator.
- AC-18.3: Kembali dari statis ke dinamis menampilkan idle melalui transisi F-03, tanpa lompatan. Pesan berikutnya dari connector kemudian menggerakkan wajah.

## 7. Kontrak pesan

Sumber kebenaran: `docs/CONTRACT.md`. Jika ada perbedaan antara PRD dan kontrak, kontrak menang sampai keduanya diperbarui.

Ringkasan event (DRAFT):

| Event | Payload | Sumber |
|---|---|---|
| `brone://ekspresi` | `{tipe, id, emosi, intensitas, durasi_ms}` | connector ke FE |
| `brone://viseme` | `{tipe, id, jadwal: [{t, v}]}` | connector ke FE |
| `brone://bicara` | `{tipe, status}` | connector ke FE |

## 8. Persyaratan non-fungsional

### 8.1 Performa

- FPS render: usulan target 60 FPS dan batas minimum 30 FPS, karena animasi perlu halus. Belum ada data untuk wajah 2D. Perlu persetujuan (Q7).
- Latensi pesan masuk ke transisi dimulai: dicatat di log. Target belum ditetapkan.
- Memori: seminimal mungkin. Ukur RSS di NUC dulu, target belum ditetapkan (Q7).
- CPU: seminimal mungkin. Ukur saat idle dan saat aktif, target belum ditetapkan (Q7).

### 8.2 Stabilitas

- Aplikasi berjalan minimal 8 jam tanpa crash dalam skenario S-05. Opsional, bukan syarat rilis (diputuskan, Q28).
- Memori tidak naik terus-menerus (kebocoran diperiksa dengan pengukuran RSS per jam).

### 8.3 Platform

- OS: Ubuntu versi sama dengan NUC. Versi belum dikonfirmasi (Q32, usulan 24.04 LTS).
- Browser engine: WebKitGTK versi dari Tauri, dicatat dengan `npx tauri info`.
- Arsitektur: x86_64.
- Build dilakukan di Linux (VM atau NUC). Pengembangan FE boleh di laptop lewat browser.

### 8.4 Keamanan

- Connector hanya menerima koneksi dari localhost. Mekanisme transport menunggu tim LLM (Q1).
- Pesan dari luar kontrak tidak pernah dieksekusi, hanya ditampilkan sebagai parameter yang sudah divalidasi.
- Tidak ada data pribadi yang disimpan.

### 8.5 Maintainability

- FE dan BE hanya bertemu lewat kontrak.
- Setiap modul FE (state, interpolator, renderer, blink, viseme, connector) punya satu tanggung jawab.
- Setiap aturan validasi di BE punya tes unit.

## 9. Struktur repo

Sesuai `brone-gui/`:

```
src/                 FRONTEND
  index.html
  css/style.css
  js/main.js         titik masuk
  js/state.js        F-05, F-08
  js/interpolator.js F-03
  js/renderer.js     F-01, F-02
  js/blink.js        F-04
  js/viseme.js       F-06
  js/connector.js    F-05, F-07
  js/mode.js         F-16, F-18 (pemilihan dan perpindahan mode)
  js/panel.js        F-17 (panel pemilihan manual)
  assets/
src-tauri/           BACKEND
  src/connector/mod.rs
  src/connector/protocol.rs   F-10
  src/security/auth.rs        F-16 (verifikasi password, di backend)
docs/                PRD, CONTRACT, DECISIONS, BENCHMARK
benchmark/           sample_resources.sh (F-12)
config/              (baru) file config, F-14
```

## 10. Milestone

| Fase | Isi | Selesai jika |
|---|---|---|
| M0 | Repo, Tauri jalan di NUC, jendela fullscreen | `npm run tauri dev` menampilkan jendela kosong di NUC |
| M1 | Render wajah netral, kedip (F-01, F-04, F-14) | Wajah tampil dan berkedip sesuai AC |
| M2 | Ekspresi, transisi, dan mode statis dasar (F-02, F-03, F-05, F-16, F-17) | Semua 7 ekspresi bisa dipilih dari panel dan dipanggil lewat event uji |
| M3 | Viseme, bicara, dan mode dinamis (F-06, F-07, F-08, F-18) | Jadwal viseme uji tampil sinkron. Pindah mode tidak mengganggu pesan |
| M4 | Connector dan validasi (F-10, F-11) | Pesan tidak valid dibuang dan tercatat |
| M5 | Benchmark dan autostart (F-12, F-13) | Hasil benchmark pertama di NUC tersimpan |
| M6 | Uji stabilitas 8 jam (S-05) dan keputusan final | Laporan benchmark disetujui tim |

## 11. Definisi selesai (Definition of Done)

Sebuah fitur dianggap selesai jika:
1. Semua acceptance criteria-nya terpenuhi dan diuji.
2. Kode mengikuti struktur di bagian 9.
3. Tidak ada nilai ajaib di kode. Nilai yang bisa berubah ada di config.
4. Tes unit ada untuk logika BE dan logika interpolasi FE.
5. Dicoba di NUC, bukan hanya di laptop.
6. Log mencatat peristiwa penting sesuai F-11.

## 12. Pertanyaan terbuka

Harus diputuskan sebelum implementasi terkait:

| No | Pertanyaan | Dampak | Usulan awal |
|---|---|---|---|
| Q1 | Transport dari modul LLM ke connector | F-05, F-10, 8.4 | **Diputuskan:** MQTT. LLM publish `robot/expression` dan `robot/voice_stage`; adapter di backend GUI memetakan payload dan emosi (audit 11 November 2026) |
| Q2 | Dari mana waktu audio untuk viseme berasal | F-06 | **Diputuskan:** timestamp dari tim LLM, yaitu saat audio mulai diputar. Basis waktu detail ada di Q26 |
| Q3 | Siapa yang mengubah fonem jadi viseme | F-06 | **Diputuskan:** JSON dari tim LLM sudah berisi timestamp dan viseme. GUI tidak mengubah fonem |
| Q4 | Efek air mata, tanda seru, tanda tanya | F-09 | **Diputuskan:** efek dianimasikan. Air mata mengalir. Tanda seru dan tanda tanya masuk dan keluar dengan animasi |
| Q5 | Happy dan Happy1 | F-02 | **Ditutup.** HAPPY1 salah input |
| Q6 | Ada alis atau tidak | F-01 | **Ditutup.** Tidak ada alis |
| Q7 | Target FPS, memori, dan CPU di NUC | 8.1 | **Usulan:** FPS 60, minimum 30. Memori dan CPU seminimal mungkin, diukur dulu. Perlu persetujuan |
| Q8 | Session X11 atau Wayland di NUC | F-13 | **Belum diketahui.** Cek dengan `echo $XDG_SESSION_TYPE` |
| Q9 | Operator boleh keluar dari aplikasi | F-13 | **Diputuskan:** tombol `Esc`. Catatan: Esc bisa tertekan tidak sengaja saat di lab |
| Q10 | Brave kiosk atau Tauri di NUC | Framework | **Diputuskan:** Tauri di NUC |
| Q11 | Input lain selain pesan dan mode statis | Scope | **Diputuskan:** tidak ada |
| Q12 | Cara pindah mode | F-16 | **Diputuskan:** tombol `F2` untuk berpindah mode, dan flag config untuk mode awal |
| Q13 | Viseme di mode statis: langsung atau dengan transisi? | F-17 | **Diputuskan:** langsung tanpa transisi. Mode statis dipakai untuk memeriksa setiap ekspresi dan viseme |
| Q14 | Saat kembali ke dinamis, wajah tampil dengan state apa? | F-18 | **Diputuskan:** idle, lalu menyesuaikan dengan interaksi berikutnya. Pesan yang datang saat mode statis dibuang |
| Q15 | Apakah mode statis ada di build produksi (robot untuk Civitas akademika)? | F-16, F-17 | **Diputuskan:** nonaktif secara default lewat config. Diaktifkan atau dinonaktifkan dengan `F2` plus password. Robot untuk civitas akademika adalah mode dinamis |
| Q16 | Robot punya keyboard atau tidak? `F2` tidak bisa dipakai tanpa keyboard | F-16 | **Diputuskan:** keyboard dan monitor besar hanya ada di lab, bisa dilepas. Mode statis hanya bisa diubah saat keyboard terhubung (AC-16.10 dan AC-16.11) |
| Q17 | Lokasi file hash password dan parameter kunci (3 kali salah, 60 detik) | F-16 | **Diputuskan:** `/etc/brone/secret` dengan izin 600. Kunci 60 detik setelah 3 kali salah. Pergantian password lewat skrip terpisah |
| Q20 | Mana yang `senang` dan mana yang `sangat_senang` | F-02 | **Diputuskan:** HAPPY = `senang`, HAPPIER = `sangat_senang`. HAPPIER (TRANSITION) dipakai sesaat, misalnya saat mengucapkan "Halo" |
| Q21 | Pengelompokan G dan L | F-06 | **Diputuskan:** G ikut ke I (kelompok `I_G`). L ikut ke N (`N_L`). K tetap sendiri (`K`) |
| Q22 | Gambar untuk viseme `DIAM` (mulut diam) | F-06 | **Diputuskan:** mulut diam memakai mulut dari ekspresi `netral` (BRONE_FACE_BASE) |
| Q23 | Nama kontrak ekspresi transisi, dan kembali ke mana setelah durasinya habis | F-02, CONTRACT | **Diputuskan:** HAPPIER (TRANSITION) dipakai sesaat, misalnya saat menyapa. Setelah selesai kembali ke `sangat_senang`. Nama kontrak `sangat_senang_transisi` (disetujui) |
| Q24 | Jika keyboard tidak tersedia dan perlu pemeriksaan wajah di lapangan, apa yang dilakukan? | F-16 | **Diputuskan:** pemeriksaan wajah (mode statis) hanya dilakukan saat keyboard terpasang |
| Q25 | Rasio layar: desain 5:3 (3200x1920), monitor umum 16:9. Bagaimana menyesuaikan? | F-15 | **Diputuskan:** Rasio acuan ditetapkan 800x480 (5:3), persis proporsional dengan desain 3200x1920. Pada layar berbeda, dipusatkan dengan letterbox tanpa distorsi |
| Q26 | Basis waktu viseme: `t` relatif terhadap awal audio, atau waktu absolut? | F-06, CONTRACT | Belum diputuskan. Usulan: relatif (`t` = 0 saat audio mulai diputar) |
| Q27 | Lokasi file log | F-11 | Belum diputuskan. Usulan: `~/.local/state/brone/logs/` |
| Q28 | Offset sinkron bibir: seberapa cepat mulut digeser dari suara (`offset_viseme_ms`) | F-06 | Belum diputuskan. Usulan: nilai awal 0, lalu diukur di NUC. Jangan memakai 1 detik. Perlu diskusi dengan pembimbing |
| Q19 | Peta tombol: angka `1` sampai `7` untuk ekspresi, huruf `Q` sampai `G` untuk viseme, `F3` untuk tampilkan atau sembunyikan panel | F-17 | **Diputuskan.** `F3` menampilkan atau menyembunyikan panel. Tombol intensitas dihapus |
| Q18 | Panel mode statis tampil di monitor mana? | F-17, 8.4 | **Diputuskan:** panel hanya tampil di monitor besar lab. Monitor wajah tidak pernah menampilkan panel. Jika monitor besar dilepas saat mode statis, aplikasi kembali ke dinamis |

## 13. Asumsi

- Robot dan NUC selalu punya monitor wajah yang terhubung.
- Keyboard dan monitor besar hanya terpasang di lab. Keduanya bisa dilepas, dan aplikasi harus tetap berjalan normal tanpa keduanya (diputuskan, Q16).
- Modul LLM dan suara sudah atau akan mengikuti kontrak di `docs/CONTRACT.md`.
- Desain ekspresi (gambar) adalah acuan final untuk parameter, sampai ada revisi dari tim desain.
- Pengembangan FE dilakukan di laptop lewat browser, build dan uji Tauri di Linux.

## 14. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| WebKitGTK di Linux lebih berat dari perkiraan | Performa tidak memenuhi target | Benchmark dini di M0 dan M5 |
| Kontrak viseme berubah setelah FE selesai | Rework mulut | Viseme dibuat konfigurasi, bukan kode |
| Waktu audio tidak sinkron dengan jadwal | Mulut tidak pas dengan suara | Uji dengan jadwal buatan lebih dulu |
| Desain ekspresi belum final | Parameter perlu diulang | Parameter di config, bukan kode |
| Pesan sangat sering masuk | FPS turun | Batasi antrean dan buang pesan yang sudah basi |

## 15. Instruksi khusus untuk agent

- Jangan mengubah file yang dibuat oleh `create-tauri-app` (`Cargo.toml`, `tauri.conf.json`, `capabilities/`) kecuali diminta secara eksplisit.
- Jangan menambahkan dependensi baru tanpa mencatat alasannya di `docs/DECISIONS.md`.
- Jangan mengimplementasikan fitur bertanda TBD atau pertanyaan terbuka sebelum keputusannya ada.
- Jangan mengarang angka target. Kalau butuh nilai, tandai sebagai asumsi.
- Ikuti struktur di bagian 9. Kode FE di `src/`, kode BE di `src-tauri/`.
- Tulis tes untuk setiap aturan validasi di BE.
- Setiap perubahan kontrak harus diperbarui di `docs/CONTRACT.md` lebih dulu.
- Mode statis dan mode dinamis hanya berbeda di sisi FE. Kontrak pesan tidak berubah karena mode.
- Jangan menambahkan elemen panel ke tampilan dinamis. Panel hanya tampil saat operator membukanya di mode statis.
- Mode statis nonaktif secara default. Hanya bisa diaktifkan dengan password (F-16). Jangan menyimpan password atau hash di dalam repo.
- Peta tombol ada di `config/keymap.json`. Jangan menulis kode tombol langsung di JavaScript.
