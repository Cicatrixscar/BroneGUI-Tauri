# Laporan Revisi Horizontal Gaze Brone

Tanggal: 25 November 2026. Status: revisi lokal, tanpa commit.

## 1. Revisi yang diterapkan

Batas global sekitar ±1,6 SVG diganti dengan **rentang per ekspresi yang dapat dikalibrasi**, tetap dibatasi geometri wajah dan posisi asal mata. Penyebab gerak hampir tidak terlihat sebelumnya adalah pemakaian envelope variasi ekspresi sebagai wilayah gaze dan irisan terkecil seluruh pose. Envelope tersebut bukan wilayah gerak yang dirancang untuk gaze, sehingga tidak dipakai lagi.

Konfigurasi awal sekarang menggunakan `amplitudeRatio: 0.155`, yaitu 15,5% lebar mata referensi ekspresi. Pada idle hasilnya sekitar ±20 SVG, dengan total perjalanan kiri-kanan sekitar 40 SVG, dibanding sebelumnya 3,2 SVG. Nilai ini merupakan kandidat kalibrasi visual Brone, bukan konstanta yang diklaim berasal dari jurnal.

Yang dipertahankan: payload CV, penerimaan semua angka finite, clamp GUI [-1,1], mirroring, gerak kedua mata bersama, smoothing, clipping, mode statis, dan isolasi dari timer mulut/viseme. Cry/menangis/timeout tetap berpusat.

## 2. Arsitektur dan file kode

```text
CV: X finite bebas
  -> backend/adapter memvalidasi payload dan meneruskan X asli
  -> FaceState: clamp [-1,1] dan koreksi arah
  -> profil geometri per ekspresi yang dihitung pada startup
  -> renderer memilih profil aset mata yang sedang tampil
  -> smoothing offset dalam satuan SVG dan final clamp
  -> translate pada parent kedua mata
```

| File/fungsi | Revisi |
|---|---|
| [gaze.js](../src/js/gaze.js), `measureGazeGeometry` | Menghapus envelope lintas ekspresi dan irisan global. Menghitung interval aman, region lokal, lebar referensi, dan maksimum masing-masing pose |
| [renderer.js](../src/js/renderer.js), `updateGaze` | Menggunakan `renderedEyeEmotion` untuk memilih rentang. Interpolasi dalam SVG agar perubahan maksimum tidak mengalikan posisi lama |
| `transitionToEmotion` dan callback swap aset | Semua transisi dengan anime.js memusatkan offset selama mata menutup, mengganti aset di nol, kemudian menuju target dengan profil baru |
| `updateEyes` | Mencatat ekspresi aset yang benar-benar ditampilkan dan memperbarui clip rectangle |
| [config.json](../src/config/config.json) | Menambah `gaze.amplitudeRatio: 0.155` |
| [main.js](../src/js/main.js) | Fallback memuat amplitudeRatio yang sama; override lokal objek gaze digabung dengan config dasar |
| [state.js](../src/js/state.js), `setGaze` | Tetap clamp X dan mirroring, tanpa penguatan sensitivitas |
| [index.html](../src/index.html) | Clip mata dari implementasi sebelumnya dipertahankan; timeout tetap tidak dipotong oleh clip pose diam |
| [gaze.test.js](../tests/fe/gaze.test.js) | Sweep memakai batas per pose; menambah uji kalibrasi, cap geometris, dan transisi rentang berbeda |
| [verify-gaze.mjs](../scripts/verify-gaze.mjs) | Membandingkan transform dengan rentang ekspresi, memeriksa region lokal dan pusat mata, serta target akhir setiap ekspresi |

Backend Rust tidak memerlukan perubahan: validator finite dan penerusan nilai asli sudah sesuai kontrak. Tidak ada dependency atau loop animasi baru.

## 3. Rumus rentang per ekspresi

### 3.1 Constraint geometris lokal

Untuk mata dengan rectangle dasar `(x,y,w,h)`, pusat X dasarnya adalah `x+w/2`. Kebijakan jangkar Brone yang dipakai adalah:

- Pusat mata yang digeser tetap berada dalam interval horizontal rectangle posisi asal `[x,x+w]`. Ini memberi `-w/2 <= dx <= w/2` dan mempertahankan sekurangnya separuh overlap horizontal rectangle asal.
- Seluruh rectangle mata tetap berada pada sisi wajahnya: mata kiri tidak melintasi X=tengah wajah, mata kanan juga tidak melintasi ke sisi kiri.
- Seluruh rectangle tetap di dalam rounded face. Inset kiri/kanan dihitung dari lingkaran sudut pada seluruh rentang Y rectangle mata.

Ini kebijakan rekayasa untuk mata utuh Brone, bukan definisi EOR sudut Fang atau bukti persepsi manusia. Ia menggantikan envelope variasi ekspresi yang terlalu ketat.

Region yang boleh ditempati seluruh rectangle mata dihitung sebagai:

```text
left  = max(insetWajah, x-w/2, batasKiriSisiWajah)
right = min(lebarWajah-insetWajah, x+1.5w, batasKananSisiWajah)

left-x <= dx <= right-(x+w)
```

Iris interval kedua mata untuk satu ekspresi:

```text
lower_e = max(lower mata kiri, lower mata kanan)
upper_e = min(upper mata kiri, upper mata kanan)
G_e = min(-lower_e, upper_e)
```

G_e merupakan cap geometris simetris ekspresi tersebut. Tidak diiris dengan ekspresi lain. Region dan cap berubah bersama ukuran/posisi mata; pose transisi tidak membatasi idle.

### 3.2 Kalibrasi visual dan normalisasi dimensi

```text
W_e = min(lebar mata kiri, lebar mata kanan)
R = gaze.amplitudeRatio
M_e = min(R * W_e, G_e)
u = clamp(xCV,-1,1) * direction
TargetOffsetSVG = u * M_e
```

R mengatur keterlihatan gerak, sedangkan G_e merupakan pengaman geometris. Walaupun R dibesarkan, maksimum tetap tidak dapat melewati G_e. Rasio bukan tambahan penguatan CV: nilai X=0,4 tetap berarti 40% rentang ekspresi, dan input 1/8/100 mencapai batas yang sama.

Pada konfigurasi produksi saat ini:

| Ekspresi | W_e SVG | G_e SVG | M_e SVG pada R=0,155 |
|---|---:|---:|---:|
| idle / happy / shock | 129 | 64,5 | 19,995 |
| happier | 123 | 61,5 | 19,065 |
| sad | 142 | 71 | 22,01 |
| confused / thinking | 129 | 64,5 | 19,995 |
| happier_transisi | 156 | sekitar 78 | 24,18 |
| cry / menangis / timeout | — | — | 0, ditahan tengah |

Alias Indonesia menggunakan ukuran padanannya. `geometry.maxOffsetX` pada hasil pengukuran hanya ringkasan maksimum profil untuk diagnostik; renderer tidak memakainya sebagai satu rentang global.

Jika seluruh dimensi wajah dan mata diperbesar dua kali, cap dan perpindahan ikut dua kali, sedangkan R tetap. Satuan runtime adalah SVG pada viewBox 800 × 480, bukan piksel fisik atau milimeter.

## 4. Transisi tanpa perubahan skala yang meloncat

Sebelumnya interpolasi dilakukan pada nilai gaze ternormalisasi, lalu dikalikan maksimum. Jika maksimum berubah saat nilai ternormalisasi tidak nol, posisi dapat meloncat. Renderer sekarang menyimpan posisi/interpolasi gaze dalam **satuan SVG**.

Pada transisi ekspresi dengan anime.js:

1. Ambil posisi offset yang sedang ditampilkan.
2. Gerakkan menuju nol selama paruh penutupan kedip.
3. Pada callback pergantian aset, pastikan offset nol dan ganti clip rectangle serta profil ekspresi.
4. Setelah swap, gerakkan dari nol menuju target CV terbaru dengan rentang ekspresi baru selama mata membuka.

Target CV tetap disimpan selama transisi. Pesan baru tidak mengakumulasi geseran. Pose `happier_transisi` boleh mempunyai rentang sendiri jika ditampilkan, tetapi tidak mempersempit rentang ekspresi lainnya.

Cry/menangis/timeout selalu terpusat saat efek khusus aktif. Ketika keluar, gaze menunggu transisi selesai lalu mengikuti target terbaru. Gaze tidak mengubah jadwal mulut dan viseme.

Tanpa anime.js, aset berganti langsung dan gaze tetap diinterpolasi dalam SVG, dengan final clamp terhadap profil baru. Bila posisi lama berada di luar batas baru, clamp keselamatan dapat mengoreksinya langsung; tidak ada jaminan tanpa koreksi mendadak untuk fallback ini. Reset mode dan profil invalid juga mengutamakan keselamatan dengan pemusatan langsung.

Clip rectangle memastikan painted extent gaze aktif tidak melampaui rectangle yang diuji. Timeout dikecualikan dari clip pose diam agar spiral berotasi utuh, dengan gaze nol. Geometri diukur saat startup; reload setelah mengubah config/aset.

## 5. Cara kalibrasi lokal

Konfigurasi awal pada `src/config/config.json` dan fallback:

```json
"gaze": {
  "invertX": true,
  "faceCornerRadius": 40,
  "amplitudeRatio": 0.155,
  "durationMs": 150
}
```

Untuk pengujian lokal, dapat membuat `src/config/config.local.json` dengan hanya nilai yang ingin diubah:

```json
{
  "gaze": {
    "amplitudeRatio": 0.18
  }
}
```

Override gaze kini digabung dengan config dasar sehingga radius, arah, dan durasi tidak hilang. File override tidak dibuat otomatis dalam revisi ini. Reload browser/restart aplikasi setelah perubahan.

Gunakan `node scripts/test-gaze.mjs 700 10` untuk sepuluh siklus kiri-kanan. Periksa idle, happier, sad, confused, shock, dan pergantian ekspresi pada layar robot. Pilih rasio yang geraknya cukup jelas tanpa terasa lepas dari wajah. R=0 menonaktifkan perpindahan; nilai negatif, string, atau nonfinite membuat profil gaze invalid dan ditahan di tengah. Nilai R besar tetap dipotong cap geometri, tetapi lolos cap bukan berarti tampilannya sudah nyaman secara perseptual.

`gaze.maxOffsetX` dan `gaze.sensitivity` lama tidak digunakan. CV tetap cukup mengirim X finite; koreksi mirroring hanya satu kali.

## 6. Hubungan dengan referensi

| Referensi | Prinsip yang diadaptasi | Implementasi Brone dan batas klaim |
|---|---|---|
| Rubies, Palacín, Clotet (2022), bagian 3.2, Figure 3/Table 2, persamaan 6–8, PDF 7–8 | Perpindahan pupil dinyatakan relatif terhadap diameter sklera dan membutuhkan kalibrasi | Memakai R × lebar mata per ekspresi. Brone menggeser mata utuh, jadi tidak menyalin rumus sklera atau angka robot penelitian |
| Fang et al. (2024), bagian 3.1.2–3.1.3, PDF 6–7 | Eye-Only Range membatasi gerak mata sebelum melibatkan kepala | Region lokal dan saturasi membatasi gaze horizontal Brone. Tidak mengimplementasikan EOR sudut, VOM, atau motor kepala |
| Vázquez (2017), bagian 7.2.2, PDF 64 / halaman 57 | Perpindahan mengikuti dimensi mata; posisi di luar batas ditolak | W_e menjadi skala perpindahan; final clamp dan constraint region mencegah keluaran melampaui batas yang ditetapkan |
| Vázquez (2017), Appendix A, PDF 92 / halaman 85 | Kedua pupil memakai pemetaan bersama dan hasil proyeksi dibatasi | Kedua gambar mata memakai offset bersama; tidak memakai proyeksi 3D karena kontrak hanya satu X |

Dasar penelitian tetap dipertahankan pada prinsip dimensi relatif, region gerak, serta constraint keluaran. **R=0,155, aturan pusat tetap di rectangle asal, pembagian sisi wajah, dan pemusatan ketika kedip merupakan keputusan desain Brone.** Nilai tersebut tidak diklaim sebagai parameter optimal dari jurnal.

Perubahan dari envelope global merupakan koreksi pilihan implementasi sebelumnya, bukan penyimpangan dari ketentuan jurnal. Referensi tidak mengharuskan batas 1,6 SVG dan tidak mensyaratkan menyalin seluruh metode tanpa penyesuaian.

## 7. Pengujian dan bukti

### Pengujian frontend

Perintah: `node --test --test-reporter=tap tests/fe/*.test.js`.

Hasil revisi: **75 tes lulus, 0 gagal**, termasuk 19 tes gaze. Output lengkap: [frontend-tests.tap](../reports/gaze/frontend-tests.tap).

Cakupan utama:

- Input finite bebas, clamp [-1,1], pecahan tanpa penguatan, mirroring, duplikasi dan retarget.
- Sweep 201 nilai horizontal untuk 15 pose gaze aktif, kedua mata, dan tiga faktor kedip.
- Scaling geometri 2×, rounded corners, profil invalid dan override maksimum lama yang tidak berlaku.
- Amplitudo produksi sekurangnya 10× batas 1,6 lama pada semua pose gaze aktif.
- Rasio besar dipotong G_e; rasio nol dan invalid ditangani.
- Pergantian idle ke happier: posisi awal kontinu, nol saat swap, kemudian mencapai rentang baru tanpa mengubah target CV.
- Pemusatan/resume cry, menangis, timeout; sweep rotasi timeout; mode dan isolasi mulut/viseme.

### Pengujian browser

Harness `scripts/verify-gaze.mjs` memeriksa jalur CLI -> HTTP -> SSE -> SVG, bukan hanya fungsi matematis. Hasil aktif tersimpan di [verification.json](../reports/gaze/verification.json), termasuk profil setiap ekspresi dan target akhirnya.

Pada run terakhir, **271 frame** transisi diperiksa. Matriks DOM, rounded face, region lokal, posisi pusat terhadap jangkar, clip rectangle, dan aset akhir diperiksa selama perubahan ekspresi utama. Pengujian streaming dihentikan sebelum sweep ekspresi agar timer bicara tidak mencampuri pengamatan. Viewport 400 × 240, 1600 × 960, dan 1000 × 600 juga diperiksa. Semua viewport tersebut berasio 5:3; rasio layar lain belum tercakup run ini.

Probe masing-masing 120 frame idle/aktif dicatat di JSON, termasuk p50/p95 interval RAF dan jumlah penulisan transform. Pada run terakhir, p95 interval RAF idle dan aktif sama-sama sekitar 16,7 ms; jumlah penulisan transform masing-masing 0 dan 117. Gaze diam tidak menulis ulang transform. Probe desktop headless tidak membuktikan kapasitas robot, latency kamera-ke-layar, memory, atau beban thermal.

[Perbandingan kiri–tengah–kanan](../reports/gaze/gaze-comparison.png), [contact sheet ekspresi](../reports/gaze/expression-contact-sheet.png), [kiri](../reports/gaze/left.png), [tengah](../reports/gaze/center.png), dan [kanan](../reports/gaze/right.png) diperbarui setelah pengujian browser. [Evidence manifest](../reports/gaze/evidence-manifest.json) merekam hash kode, test/harness, dan PDF referensi.

## 8. Kesimpulan yang dapat dipertanggungjawabkan

| Klaim | Status |
|---|---|
| Gerak tidak lagi dibatasi maksimum global 1,6 | Terimplementasi dan diuji terhadap profil produksi |
| Rentang mengikuti lebar dan geometri per ekspresi | Terimplementasi dan diuji |
| Rasio amplitudo dapat dikalibrasi tanpa melewati cap geometri | Terimplementasi dan diuji |
| Perubahan rentang saat transisi normal tidak mereskalakan offset lama | Interpolasi SVG dan swap di tengah diuji |
| Kedip, mode, ekspresi utama dan isolasi mulut tetap berjalan | Lulus cakupan tes dan browser yang tersedia |
| Gerak cukup terlihat dan alami pada perangkat robot | Perlu evaluasi lokal pengguna; screenshot bukan eksperimen persepsi |
| Implementasi mereproduksi hasil eksperimen ketiga penelitian | Tidak diklaim; ini adaptasi prinsip untuk mata utuh Brone |
| MQTT/Tauri nyata dan performa robot telah lulus | Belum diverifikasi langsung dalam pekerjaan ini |

Gerak idle kini sekitar 12,5× lebih besar daripada versi envelope global. Amplitudo awal dimaksudkan untuk diuji, bukan dianggap final hanya karena lolos batas geometri. Jika perlu penyesuaian, ubah amplitudeRatio dan evaluasi seluruh ekspresi; constraint geometris tetap berlaku.

Tidak ada commit yang dibuat. Perubahan lokal sebelumnya dipertahankan.

## 9. Referensi

- Elena Rubies, Jordi Palacín, Eduard Clotet. 2022. *Enhancing the Sense of Attention from an Assistance Mobile Robot by Improving Eye-Gaze Contact from Its Iconic Face Displayed on a Flat Screen*. Sensors 22, 4282. [DOI](https://doi.org/10.3390/s22114282). PDF lokal: `sensors-22-04282-v2 (1).pdf`.
- Yu Fang et al. 2024. *Enhancing social robot's direct gaze expression through vestibulo-ocular movements*. Advanced Robotics 38(19–20), 1457–1469. [DOI](https://doi.org/10.1080/01691864.2024.2398556).
- Marynel Vázquez. 2017. *Reasoning About Spatial Patterns of Human Behavior During Group Conversations with Robots*. Tesis PhD, Carnegie Mellon University. PDF lokal: `vazquez_thesis.pdf`.
