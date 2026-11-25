# Rencana Horizontal Gaze Brone Berbasis Geometri

> Rencana dan revisi di bawah merupakan riwayat perancangan. Hasil implementasi serta batas buktinya per 25 November 2026 ada di [laporan implementasi berbasis geometri](laporan-implementasi-gaze-berbasis-geometri.md). Kontrak aktif ada di CONTRACT.md.

Tanggal: 24 November 2026. Status: usulan untuk ditinjau, belum diimplementasikan.

> Revisi setelah diskusi dan implementasi lokal: CV tetap boleh mengirim semua X finite. Backend/adapter meneruskan nilai asli; GUI melakukan clamp ke [-1,1], lalu koreksi arah, tanpa penguatan sensitivitas. Bagian kontrak di bawah yang mengusulkan penolakan X di luar rentang sudah digantikan keputusan ini. Clamp sudah diterapkan; batas geser 20 satuan SVG tetap sementara. Pengukuran wilayah jangkar, penentuan M berbasis geometri, dan pemusatan halus cry/timeout belum diimplementasikan. Detail perilaku aktif ada di CONTRACT.md.

Analisis mengacu pada working tree proyek saat pemeriksaan, dengan HEAD `72f164f`. Dokumen ini terpisah dari `rancangan-gaze-horizontal.md`, yang sudah mencatat implementasi gaze terdahulu. Perubahan lokal yang sebelumnya ada pada dokumen tersebut dan `scripts/test-gaze.mjs` dipertahankan. Isi PDF diperlakukan sebagai bahan penelitian, bukan instruksi untuk mengubah proyek.

## 1. Keputusan utama dan batas lingkup

Gunakan jalur MQTT/Tauri, state wajah, hierarki SVG, dan loop render yang sudah tersedia. CV mengirim satu koordinat horizontal ternormalisasi. GUI memetakan koordinat tersebut ke translasi bersama kedua gambar mata, dibatasi wilayah aman yang diukur dalam satuan SVG.

Brone saat ini tidak mempunyai pupil dan sklera terpisah pada DOM. Elemen yang dapat digerakkan adalah gambar mata utuh. Memisahkan pupil membutuhkan perubahan desain aset dan berada di luar rancangan tahap pertama ini.

**Nilai maksimum X operasional belum ditetapkan.** Ukuran dan posisi aset cukup untuk menghitung batas terhadap tepi wajah, tetapi belum menentukan kapan mata terlihat terlepas secara visual. Batas operasional harus merupakan irisan batas geometris wajah, wilayah jangkar mata, dan batas perseptual hasil kalibrasi Brone. Angka konfigurasi lama bukan hasil kalibrasi tersebut.

Lingkup hanya gerakan horizontal. Gerak kepala, sumbu Y, vergence, gaze acak, pergantian target orang, serta implementasi CV tidak termasuk. Satu nilai X juga tidak cukup untuk merekonstruksi lokasi 3D, jarak pengguna, atau menjamin kontak mata yang benar dari semua sudut pandang.

## 2. Arsitektur aktual

| Komponen | Temuan pada kode | Implikasi rancangan |
|---|---|---|
| `src/index.html:14` | SVG `#wajah`, `viewBox="0 0 800 480"`, `xMidYMid meet` | Wajah memakai SVG, bukan Canvas 2D, walaupun konfigurasi bernama `canvas` |
| `src/config/config.json` | Posisi dan ukuran per ekspresi, pengaturan blink dan gaze | Sumber geometri utama; jangan memakai folder aset alternatif sebagai sumber runtime |
| `src/js/main.js` | Memuat config, override lokal, fallback `DEFAULT_CONFIG`, lalu membuat controller | Pengukuran harus memakai konfigurasi efektif; fallback juga perlu kebijakan geometri |
| `src/js/state.js:54` | `setGaze` menerima finite X, mengalikan sensitivitas dan arah, clamp ke `[-2,2]` | Sudah ada gaze; pemetaan perlu direncanakan ulang untuk kontrak normalisasi baru |
| `src/js/renderer.js:127` | Satu loop `requestAnimationFrame`; `updateGaze` berjalan bersama mulut dan blink | Tambahkan logika gaze pada loop ini; tidak perlu loop atau framework animasi baru |
| `src/js/renderer.js:189` | Easing kuadratik, retarget dari posisi saat ini, translasi parent mata | Komposisi transform sudah sesuai; batas masih berupa angka config |
| `src/js/renderer.js:395` | Mengganti `href`, X, Y, width, height mata sesuai ekspresi | Batas harus mengikuti aset yang benar-benar sedang ditampilkan |
| `src/js/blink.js`, renderer | Penjadwalan kedip; renderer/anime.js melakukan `scaleY` pada wrapper | Gaze tidak boleh menulis transform wrapper kedip |
| `src/js/mode.js` | Pergantian mode mereset gaze; pesan statis dibuang | Pertahankan semantik ini |
| `src-tauri/src/connector/ingress.rs` | Topik `robot/gaze`, JSON eksternal `type`, adapter ke `tipe` internal | Gunakan transport yang ada |
| `src-tauri/src/connector/protocol.rs` | Varian Gaze dan validasi finite | Backend belum membatasi X ke rentang normalisasi |
| `src-tauri/src/connector/mqtt.rs:59` | Mengabaikan pesan gaze dengan retained flag | Pertahankan untuk mencegah replay retained pada subscribe |
| `src/js/connector.js:219` | Gaze diproses sebelum lifecycle/deduplikasi LLM | Pertahankan pemisahan dari ekspresi dan TTS |
| `src/js/gaze.js`, `scripts/dev-server.js` | Adapter browser development melalui HTTP/SSE, termasuk bridge MQTT | Jalur development perlu konsisten, tetapi bukan bukti jalur Tauri |

Konfigurasi saat diperiksa: `sensitivity=4`, `invertX=true`, `maxOffsetX=20`, `durationMs=150`. Rumus aktual `clamp(arah × 4 × x, -2, 2) × 20` menghasilkan rentang hingga ±40 satuan SVG dan saturasi pada |X|=0,5. Angka 20 bernama `maxOffsetX`, tetapi saat ini berfungsi sebagai pengali per unit target; bukan maksimum akhir. Keberadaan tes untuk perilaku tersebut tidak membuktikan bahwa jaraknya sesuai geometri wajah.

Tidak ditemukan `src/config/config.local.json` saat pemeriksaan. Jika nanti dipakai, override gaze saat ini digabung pada tingkat objek utama, sehingga perlu validasi konfigurasi efektif, bukan asumsi bahwa setiap field diwarisi dari config dasar.

## 3. Elemen yang bergerak dan koordinat

Hierarki yang dipertahankan:

```text
#wajah                           koordinat dasar SVG 800 × 480
  #layer-backside                latar dan garis dekorasi, tetap
  #layer-blush                   pipi, tetap
  #layer-mouth                   ekspresi mulut dan viseme, tetap
  #layer-eyes                    translate(dx, 0) milik gaze
    #eye-l-wrap                  scaleY milik blink/transisi
      #eye-l                     image mata kiri; rotasi khusus timeout
    #eye-r-wrap                  scaleY milik blink/transisi
      #eye-r                     image mata kanan; rotasi khusus timeout
  #layer-tears                   air mata dan clip path, terpisah dari mata
  #layer-effects                 simbol ekspresi, tetap
```

X bertambah ke kanan layar; Y bertambah ke bawah. Istilah kiri/kanan pada dokumen ini menunjuk layar yang dilihat pengguna, bukan anatomi robot. `dx` ditambahkan ke posisi dasar ekspresi; bukan diakumulasikan pada setiap pesan. Kedua mata memakai `dx` yang sama sehingga jarak antar pusat tetap pada ekspresi yang sama.

Konversi tampilan untuk viewport W × H adalah `s = min(W/800, H/480)`, dengan offset letterbox `ox=(W-800s)/2`, `oy=(H-480s)/2`. Maka `xPixel=ox+s×xSVG` dan `dxPixel=s×dxSVG`. Jangan mengalikan lagi dengan devicePixelRatio pada transform SVG.

`MATA.svg` memiliki viewBox 129 × 171, ellipse berpusat (64,5;85,5), serta outline dengan stroke 4. Ujung outline dan stroke mengisi lebar sekitar 0 sampai 129. Ini ilustrasi mata utuh dengan highlight, bukan pupil DOM yang dapat digeser terpisah. Untuk aset lain, rectangle `<image>` bisa mengandung ruang kosong. Perhitungannya harus membedakan rectangle penempatan dan area gambar yang benar-benar terlihat.

## 4. Hasil pengukuran awal

Tabel berikut dihitung dari `expressions` pada config utama. Koordinat dalam satuan SVG. Interval terakhir hanya hasil containment rectangle gambar terhadap lebar 800, tanpa margin tambahan, rotasi timeout, atau validasi estetika.

| Ekspresi | Mata kiri (x,y,w,h) | Mata kanan (x,y,w,h) | Interval dx terhadap tepi horizontal |
|---|---|---|---|
| idle / happy / shock | 115;154;129;171 | 556;154;129;171 | [-115;115] |
| happier | 106;135;123;143 | 575;135;123;143 | [-106;102] |
| sad | 106;147;142;156 | 552;147;142;156 | [-106;106] |
| cry | 105;147;142;145 | 553;147;142;145 | [-105;105] |
| confused / thinking | 103;167;142;145 | 556;154;129;171 | [-103;115] |
| happier_transisi | 95,4;159,3;156;153 | 549;159,3;156;153 | [-95,4;95] |
| timeout, sebelum rotasi | 93,4;130,65;160;162 | 547,4;130,65;160;162 | [-93,4;92,6] |

Alias Indonesia memakai geometri padanannya pada config. Untuk netral, pusat mata (179,5;239,5) dan (620,5;239,5), jarak pusat 441, serta gap rectangle 312. Rasio lebar mata/wajah = 129/800 = 16,125%; tinggi mata/wajah = 171/480 = 35,625%; jarak pusat/lebar wajah = 441/800 = 55,125%.

Latar `BRONE_FACE_BACKSIDE.svg` memuat rectangle 800 × 480 dengan sudut radius 40. Pada rentang Y semua rectangle mata tanpa rotasi di atas, batas kiri/kanan latar adalah 0 dan 800. Karena itu interval tabel juga konservatif terhadap latar rounded rectangle untuk pose tersebut. Garis hitam dekoratif di dalam aset bukan kontur tertutup rongga mata dan tidak dapat otomatis dipakai sebagai batas sklera.

Contoh netral: mata kiri menempati [115;244], kanan [556;685]. Menuntut keduanya tetap dalam [0;800] memberi `dx ≥ -115` dan `dx ≤ 115`. **±115 adalah batas tepi untuk pose netral, bukan rekomendasi gaze.** Pada jarak itu seluruh wajah akan terasa bergeser meskipun mata belum keluar layar. Bahkan ±40 lama hanyalah 31,01% lebar mata netral; persentase tersebut belum membuktikan kelayakan visual.

## 5. Metode penentuan batas maksimal X

### 5.1 Ukur bentuk dalam ruang wajah yang sama

Untuk tiap ekspresi dan mata, catat viewBox aset, rectangle `<image>`, pemetaan `preserveAspectRatio`, silhouette terlihat termasuk stroke/filter yang keluar bentuk, pusat visual, serta transform animasi. Jika viewBox aset `(vx,vy,vw,vh)` ditempatkan ke `(x,y,w,h)` dengan `meet`, skala lokal `a=min(w/vw,h/vh)` dan offset internal `(w-a×vw)/2`, `(h-a×vh)/2` harus dihitung sebelum memindahkan bounding box ke ruang wajah.

Gunakan rectangle gambar sebagai tahap konservatif hanya jika seluruh painted extent memang tertampung di dalamnya. `getBBox()` pada `<image>` saja tidak membaca kontur di dalam SVG eksternal; `getBoundingClientRect()` menghasilkan koordinat viewport dan bukan geometri desain langsung. Audit aset dan snapshot hasil render diperlukan untuk memastikan stroke, filter, serta clipping. Tidak perlu membaca piksel atau DOM geometry setiap frame.

### 5.2 Definisikan wilayah wajah dan wilayah jangkar mata

Untuk ekspresi e, definisikan `F` sebagai bentuk latar wajah dan `R(e,i)` sebagai wilayah yang boleh ditempati **seluruh mata i**, dekat posisi aslinya. `R` harus diukur dari rancangan Brone dan disahkan lewat overlay visual. Jangan menyamakan `R` dengan seluruh layar dan jangan menganggap lebar antar mata sebagai ruang gaze bebas.

Belum ada rongga/sklera tetap atau metadata `R` di proyek. Tahap kalibrasi harus menghasilkan wilayah jangkar eksplisit: overlay posisi asal, swept silhouette saat digeser, garis dekorasi, blush, dan mulut. Kandidat batas dipersempit sampai mata tetap terbaca sebagai mata pada posisi yang sama di seluruh ekspresi yang diaktifkan. Catat koordinat wilayah, aset, viewport, dan alasan batasnya. Jika region ini belum disahkan, maksimum operasional tetap belum tersedia; sistem yang kelak diimplementasikan harus menahan gaze di tengah untuk profil geometri yang tidak valid.

Penilaian “terlihat terlepas” mempunyai unsur perseptual yang tidak bisa diturunkan unik dari ukuran SVG. Geometri menjamin containment; kalibrasi visual menentukan region yang masuk akal. Memilih konstanta seperti 10% atau 25% lebar mata tanpa bukti kalibrasi hanya mengganti angka sembarang dengan rasio sembarang.

### 5.3 Hitung interval translasi

Untuk pendekatan rectangle, misalkan painted bounds mata i adalah `[li,ri]` dan region yang disetujui `[Ai,Bi]`. Margin `mi` berasal dari kebutuhan stroke/paint yang belum tercakup dan clearance yang diukur, bukan konstanta tanpa asal. Jika painted bounds sudah mencakup stroke/filter, jangan menghitungnya dua kali.

```text
Ai + mi ≤ li + dx
ri + dx ≤ Bi - mi

lower(e) = max_i(Ai + mi - li)
upper(e) = min_i(Bi - mi - ri)
```

Iris interval tersebut dengan interval containment wajah dan interval aman terhadap overlay yang relevan. Syarat valid: `lower ≤ 0 ≤ upper`. Jika interval kosong atau pose netral tidak aman, profil harus diperbaiki; jangan menutupi geometri invalid dengan clamp.

Untuk wajah/region nonrectangular, syarat yang sebenarnya adalah `E(e,i,t)+(dx,0) ⊆ F ∩ R(e,i)`, dengan `E` painted silhouette sesudah transform pada fase animasi t. Hitung komponen interval aman yang mengandung nol. Hindari menganggap semua nilai antara minimum dan maksimum aman jika region mempunyai lubang atau hambatan. Swept bounds konservatif dapat dipakai agar pemeriksaan runtime tetap murah.

### 5.4 Normalisasi berdasarkan ukuran mata

Laporkan setiap batas juga sebagai `kMinus(e)=(-lower(e))/wRef(e)` dan `kPlus(e)=upper(e)/wRef(e)`, dengan `wRef(e)` lebar mata referensi yang dinyatakan eksplisit, misalnya minimum lebar painted bounds kedua mata. Ini memudahkan audit rasio antar ekspresi dan resize, tanpa mengklaim ada rasio universal dari penelitian.

Jika kalibrasi menghasilkan batas perseptual rasio `kVisual`, maka magnitudo aman adalah minimum batas wajah, batas region jangkar, dan `kVisual×wRef`. `kVisual` harus mempunyai catatan hasil evaluasi. Jika kalibrasi langsung menyetujui region jangkar sebagai batas visual, tidak perlu menambah faktor kedua yang menduplikasi batas tersebut.

Untuk rilis awal, gunakan interval global hasil irisan semua ekspresi dan fase transisi yang mendukung gaze. Pilih maksimum simetris `M = min(-lowerGlobal, upperGlobal)` agar satu nilai CV mempunyai skala yang konsisten saat ekspresi berganti. Ekspresi cry dan timeout tetap diperlakukan sebagai pengecualian terpusat, bukan dimasukkan sebagai range gaze bergerak. Tabel tahap 4 belum cukup untuk menghitung M operasional karena region jangkar dan painted bounds lengkap belum tervalidasi.

Batas berbeda per ekspresi dapat dikembangkan kemudian jika rentang global terlalu kecil, dengan interpolasi offset dalam ruang SVG dan final clamp setiap frame. Pergantian skala ekspresi tidak boleh membuat posisi meloncat. Untuk tahap awal, interval global lebih sederhana dan mudah dibuktikan aman.

## 6. Kontrak dan alur komunikasi yang diusulkan

```text
CV memilih target dan menghitung x ∈ [-1,1]
  → MQTT robot/gaze, tanpa retain, {"type":"gaze","x":0.5}
  → Backend Rust: parse dan validasi, tanpa menghitung geometri mata
  → event brone://gaze, {"tipe":"gaze","x":0.5}
  → connector.js dan pemeriksaan mode
  → FaceState menyimpan target ternormalisasi
  → Gaze Controller: arah, pemetaan geometri, smoothing, final clamp
  → Eye Renderer: translate pada #layer-eyes
```

Envelope JSON tetap mengikuti proyek; hanya ada satu nilai kontrol, X. CV tidak mengirim offset piksel, ukuran mata, sensitivitas, atau durasi. Untuk koordinat wajah pada citra tak tercermin, salah satu normalisasi CV yang sah adalah `x=2u/(W-1)-1`, dengan u pusat target dan W>1; pemilihan target dan penanganan citra tercermin harus disepakati pada integrasi.

Usulan konvensi: `-1` kiri layar, `0` tengah, `+1` kanan layar. GUI dapat menyediakan `invertX` untuk pemasangan kamera yang memerlukannya, tetapi pembalikan hanya dilakukan satu kali. Uji arah memakai target fisik di kiri dan kanan robot; jangan menganggap tanda X kamera otomatis sama dengan tanda X layar.

Validasi usulan: payload wajib objek dengan field `type` dan `x`; X harus number finite dalam [-1,1]. Backend menolak angka di luar rentang serta field/tipe invalid. Frontend tetap melakukan validasi dan clamp defensif ke [-1,1] untuk event internal. Payload invalid mempertahankan target terakhir dan tidak menyentuh timer wajah. Aturan ini adalah perubahan dari kontrak lama yang menerima semua finite X, sehingga dokumentasi, pengirim terminal, bridge, dan tes perlu diselaraskan pada tahap implementasi.

Pemetaan dasar baru: `u=arah×clamp(x,-1,1)`, `dxTarget=M×u`. Hilangkan penguatan default 4 dan rentang internal [-2,2] dari jalur baru agar input ternormalisasi bermakna penuh. Jika sensitivitas kelak diperlukan, gunakan kurva pemetaan eksplisit yang tetap berujung pada ±M; jangan memperbesar batas geometri. Perubahan ini harus didokumentasikan sebagai perubahan respons gaze, bukan diterapkan diam-diam pada pengirim lama.

Gaze Controller merupakan tanggung jawab logis, bukan keharusan menambah kelas atau service. `FaceState.setGaze` dan `Renderer.updateGaze` sudah membagi penyimpanan target dan animasi. `gaze.js` saat ini adapter protokol development, bukan controller animasi. Hindari menambah controller kedua yang menulis transform yang sama.

Simpan hanya target terbaru. Pesan berulang tidak mengakumulasi posisi atau membuat antrean tween. Pertahankan penolakan retained gaze. Tahap pertama mempertahankan posisi terakhir jika tidak ada pesan; CV mengirim `x:0` ketika ingin reset setelah kehilangan target. Tanpa field status/timestamp GUI tidak dapat membedakan diam yang disengaja, target hilang, dan pesan lama yang tertunda. Timeout otomatis, jika dibutuhkan kemudian, harus menjadi kebijakan terpisah dengan waktu yang diuji; retained filter saja tidak menjamin semua pesan selalu baru.

## 7. Integrasi ekspresi, kedip, dan animasi

| Kondisi | Kebijakan rencana | Alasan |
|---|---|---|
| idle, happy, shock, sad, confused/thinking, happier dan aliasnya | Gaze aktif dalam interval global yang tervalidasi | Pose dasar dan ukuran mata tetap mengikuti config ekspresi |
| happier_transisi dan transisi ekspresi umum | Validasi pose sebelum/sesudah penggantian aset; gunakan batas global sepanjang transisi | Renderer mengganti aset saat mata hampir tertutup; closed eye tidak boleh dipakai memperlebar range |
| Blink otomatis | Gaze tetap diperbarui di parent; `scaleY` hanya pada wrapper | Translasi tidak menimpa kedip, dan mata membuka di posisi terbaru |
| cry/menangis, termasuk masuk/keluar | Tampilkan tengah, simpan target terbaru; kembali mengikuti target setelah keluar | Air mata dan clip path berada di layer terpisah dengan koordinat tetap |
| timeout, termasuk masuk/keluar | Tampilkan tengah; rotasi mata tetap milik ekspresi | Rotasi mengubah swept bounds dan ekspresi spiral tidak menunjukkan arah gaze biasa |
| Mulut, viseme, streaming bicara | Tidak mengubah jadwal atau state akibat gaze | Connector sudah memiliki cabang gaze tersendiri |
| Mode statis | Reset tengah; abaikan input gaze | Konsisten dengan ModeManager saat ini |
| Kembali dinamis | Mulai tengah, tunggu input baru | Tidak memutar ulang target saat statis |

Translasi parent dan skala lokal harus tetap terpisah. Secara konseptual posisi akhir ialah translasi gaze × transform blink/ekspresi × geometri aset. Jangan menulis ulang X/Y dasar ekspresi setiap kali menerima CV.

Kode sekarang memusatkan gaze seketika saat cry/timeout terdeteksi. Untuk memenuhi kebutuhan halus, rencanakan pemusatan pada fase penutupan transisi dengan profil yang aman, dan pastikan `dx=0` sebelum air mata tampil atau rotasi timeout aktif. Jika tidak ada transisi atau pose awal sudah melanggar batas baru, keselamatan geometri diprioritaskan dengan clamp langsung. Bedakan reset keselamatan dari gerak normal dalam pengujian. Target disimpan terpisah dari offset yang ditampilkan saat gaze ditahan.

## 8. Kehalusan dan efisiensi

Pertahankan easing yang sudah ada untuk tahap awal: `p=clamp((t-t0)/T,0,1)` dan `dx=from+(target-from)×(1-(1-p)^2)`. Target baru memulai dari posisi tampilan saat itu, bukan dari posisi awal lama. Durasi 150 ms adalah konfigurasi aktual yang bisa menjadi baseline pengujian, bukan hasil penelitian atau parameter yang sudah terbukti cocok untuk robot.

Easing ini kontinu pada posisi tetapi tidak menjamin kecepatan kontinu ketika target terus berganti. Uji aliran CV dan jitter sebelum menambah filter. Jika retarget berulang menimbulkan tersendat atau keterlambatan, alternatif sederhana adalah filter eksponensial `alpha=1-exp(-dt/tau)`, `dx←dx+alpha×(target-dx)`. Pilih satu strategi utama setelah benchmark; jangan menumpuk tween, low-pass, dan debounce tanpa kebutuhan terukur. Tau dan toleransi penghentian harus berasal dari pengujian respons dan resolusi tampilan.

Baik target maupun posisi akhir harus berada dalam interval aman. Filter/easing tanpa overshoot mempertahankan interval yang konveks selama batas tetap; clamp tetap diperlukan untuk perubahan profil atau konfigurasi. Hindari spring overshoot untuk tahap ini.

Hitung geometri saat startup, perubahan aset/config, atau pergantian profil; simpan hasilnya. Resize biasa cukup mengikuti SVG. Gunakan satu RAF yang sudah ada, operasi skalar O(1), dan paling banyak satu penulisan transform parent per frame ketika nilainya berubah. Jangan melakukan fetch aset, query ukuran, rasterisasi, atau alokasi tween untuk setiap pesan. Biaya parsing pesan tetap perlu diukur pada frekuensi input tinggi; target terbaru di controller tidak otomatis membatasi trafik backend.

## 9. Hubungan dengan penelitian

### Rubies, Palacín, dan Clotet 2022

PDF `sensors-22-04282-v2 (1).pdf`, bagian 3.2, Figure 3 dan Table 2, halaman PDF 7–8, mendefinisikan posisi pupil relatif: `DL=100×pL/(sØ/2)` dan `DR=100×pR/(sØ/2)`, dengan sØ diameter sklera. Nilai 100% mereka adalah keadaan hanya setengah pupil terlihat. Penyebutan yang lebih tepat untuk daftar pustaka adalah Rubies et al., karena Clotet merupakan penulis ketiga.

Adaptasi untuk Brone adalah menggunakan satuan relatif terhadap ukuran mata dan memisahkan input ternormalisasi dari koordinat renderer. Rumus pupil/sklera dan angka ukuran APR-02 tidak dapat langsung dipakai karena Brone menggeser mata utuh dan tidak memiliki sklera tetap. Batas yang sengaja menyembunyikan setengah pupil juga berbeda dari tujuan containment seluruh mata Brone. Bagian kesimpulan, halaman PDF 20, menekankan kalibrasi yang dioptimalkan untuk desain wajah mereka dan keterbatasan penerapan umum.

### Fang et al. 2024

PDF `Enhancing social robot s direct gaze expression through vestibulo-ocular movements.pdf`, bagian 3.1.2–3.1.3, halaman PDF 6–7 / jurnal 1461–1462, memetakan gerak pupil ke permukaan 2D serta menetapkan Eye-Only Range berupa radius sudut theta. Di luar EOR, kepala ikut bergerak. EOR bukan rumus universal batas perpindahan SVG dan bukan bukti bahwa Brone boleh bergeser sejumlah piksel tertentu.

Adaptasi untuk Brone adalah region gerak mata yang eksplisit. Karena gerak kepala di luar lingkup, target yang menuntut gerakan lebih jauh harus saturasi di batas aman. Tidak diperlukan implementasi VOM, motor, atau PID dari paper untuk translasi horizontal ini.

### Vázquez 2017

Tesis `Reasoning About Spatial Patterns of Human Behavior During Group Conversations with Robots`, bagian 7.2.2.1–7.2.2.2, halaman tercetak 57 / PDF 64, memakai perpindahan `dx=eye_width×epsilon1` dan `dy=eye_height×epsilon2` pada gaze acak, serta menolak posisi pupil di luar batas mata. Ini mendukung penskalaan berdasarkan dimensi mata dan pemeriksaan batas, tetapi tidak memberi rasio maksimum universal.

Appendix A, halaman tercetak 85 / PDF 92, mempelajari proyeksi koordinat dunia 3D ke posisi pupil 2D dan tetap membatasi keluaran agar tidak keluar sklera. Adaptasi Brone mengambil prinsip pemisahan pemetaan dan constraint akhir serta gerak kedua mata bersama. Model proyeksi 3D tersebut tidak diterapkan karena input Brone hanya satu X ternormalisasi. Gaze acak dan noise pada eksperimen tesis juga bukan kebutuhan fitur ini.

Ketiga sumber mendukung metode dan kebutuhan kalibrasi, bukan angka `maxOffsetX` khusus Brone. Rumus region, containment, dan pemilihan interval global pada dokumen ini adalah rancangan rekayasa untuk struktur proyek Brone.

## 10. Tahapan implementasi setelah rencana disetujui

| Tahap | Pekerjaan yang direncanakan | Keluaran dan syarat selesai |
|---|---|---|
| 1. Bekukan kontrak | Sepakati tanda X, mirroring, input [-1,1], invalid input, kehilangan target, dan perilaku mode | Contoh payload dan tabel arah; perubahan terhadap pengirim lama teridentifikasi |
| 2. Audit geometri | Ukur painted bounds seluruh aset runtime, fallback, dan fase transisi; susun overlay wajah dan region jangkar | Manifest pengukuran berisi sumber aset/config, satuan, batas, dan screenshot; belum memilih konstanta global secara manual |
| 3. Kalibrasi visual | Evaluasi sweep kiri–tengah–kanan pada semua ekspresi aktif dan ukuran layar robot | Region jangkar serta batas visual disahkan; M dihitung sebagai irisan constraint, disertai asal semua margin |
| 4. Selaraskan protokol | Perbarui validasi Rust, adapter browser, kontrak, CLI, dan tes rentang | MQTT/Tauri dan HTTP/SSE memiliki perilaku yang sama untuk payload sah/invalid; pengirim lama dipindahkan secara eksplisit |
| 5. Integrasikan kontrol | Ganti pemetaan sensitivitas lama dengan target ternormalisasi dan profil geometri; gunakan state/renderer yang ada | Input ±1 mencapai batas terukur, 0 kembali pusat; satu penulis transform gaze; fallback tidak mengaktifkan batas tanpa validasi |
| 6. Integrasikan lifecycle | Atur transisi cry/timeout, kedip, ekspresi, mode, dan retarget | Tidak ada lompatan normal, air mata lepas, atau perubahan timer mulut akibat gaze |
| 7. Verifikasi dan profil robot | Unit test, transport nyata, screenshot, benchmark perangkat | Bukti fungsi, geometri, visual, dan performa tercatat; rilis hanya setelah seluruh gate lulus |

File implementasi yang kemungkinan disentuh nanti: state, renderer, config/fallback main, protocol/ingress, adapter gaze, bridge development, pengirim terminal, dokumen kontrak, serta pengujian yang relevan. Perubahan hierarki HTML/aset tidak diperlukan untuk rancangan dasar; hanya dipertimbangkan jika kalibrasi membuktikan struktur lama tidak cukup.

## 11. Rencana pengujian dan kriteria penerimaan

| Area | Kasus | Kriteria penerimaan |
|---|---|---|
| Kontrak | -1, 0, +1, pecahan; null, string, boolean, field tambahan/hilang, nonfinite, luar rentang | Input sah diteruskan; invalid ditolak sesuai kontrak baru dan target terakhir tetap |
| Pemetaan | Sweep monoton, pesan sama berulang, tanda arah dan mirror | 0 tepat pusat, ±1 tepat ±M, tidak ada akumulasi atau saturasi prematur pada 0,5 |
| Geometri | Semua ekspresi/alias, asset viewBox berbeda, stroke/filter, data invalid, fallback | Painted silhouette dan swept bounds berada dalam region aman; profil invalid tidak menggerakkan mata |
| Animasi | Target berganti sebelum selesai, input cepat, drop frame, resize | Posisi kontinu untuk gerak normal, tidak overshoot, hasil tidak bergantung refresh rate |
| Ekspresi | Semua perpindahan ekspresi pada X ekstrem dan saat blink | Tidak keluar region selama transisi; buka mata pada posisi sah; cry/timeout tepat pusat saat efek aktif |
| Blink | Anime.js aktif dan fallback | Kedip lengkap dan gaze tidak menimpa scaleY |
| Mulut | Ekspresi dengan viseme bawaan, streaming, fallback | Urutan dan jadwal mulut sama dengan baseline tanpa gaze |
| Mode/lifecycle | Statis/dinamis, reconnect, retained gaze, tidak ada input | Reset dan pengabaian pesan sesuai kebijakan; tidak ada replay target statis/retained |
| Transport | MQTT melalui Rust/Tauri; HTTP/SSE development | Keduanya diverifikasi tersendiri; hasil browser tidak menggantikan backend nyata |
| Tampilan | 800×480, 400×240, 1600×960, aspect ratio berbeda dan layar robot | Rasio posisi tetap, letterbox benar, mata tidak tampak lepas; screenshot overlay disetujui |
| Performa | Baseline vs gaze, bicara dan blink bersamaan, input 10/30/60 Hz serta burst | Tidak ada antrean target yang tumbuh, memory stabil, biaya update bounded; p95 frame time memenuhi budget refresh layar robot |

Frame budget diturunkan dari refresh rate perangkat: `1000/Hz` ms per frame, lalu dibandingkan dengan baseline seluruh GUI. Ukur p50/p95/p99 frame time, CPU, memory, latensi terima-ke-tampil, dan error terhadap target. Frekuensi input di tabel adalah skenario uji, bukan klaim kapasitas robot. Nilai tau/durasi dan target latensi final ditetapkan setelah uji respons pada perangkat, bukan dari asumsi kemampuan desktop.

Tes saat ini di `tests/fe/gaze.test.js` memeriksa perilaku lama termasuk angka ekstrem, penguatan, easing, dan lifecycle. Pertahankan cakupan yang masih relevan; ubah ekspektasi kontrak/pemetaan hanya pada tahap implementasi. Tambahkan pemeriksaan berbasis geometri yang menguji containment, bukan sekadar mengulang konstanta config.

Perintah yang direncanakan untuk tahap verifikasi: `node --test tests/fe/*.test.js`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, dan `node scripts/verify-gaze.mjs` setelah harness diselaraskan dan server development tersedia. Lanjutkan dengan uji broker nyata serta Tauri pada robot. Pada pekerjaan perencanaan ini tidak dilakukan build, eksekusi tes fitur, koneksi broker, atau perubahan runtime; bukti yang dihasilkan adalah inspeksi kode, perhitungan dari config, dan penelaahan PDF beserta halaman relevan yang dirender.

## 12. Keputusan yang masih harus dituntaskan sebelum implementasi

1. Ukur dan sahkan region jangkar tiap mata pada desain Brone. Inilah data utama yang belum tersedia untuk menentukan M operasional.
2. Konfirmasi arah fisik kamera dan koreksi mirror satu kali pada integrasi CV.
3. Putuskan perpindahan pengirim lama dari finite-X bebas/sensitivitas 4 ke kontrak [-1,1] baru, termasuk pembaruan utilitas terminal.
4. Tetapkan parameter kehalusan dan budget performa dari uji pada perangkat robot.

Dokumen ini dapat dipakai sebagai dasar implementasi berikutnya, tetapi tidak mengubah kontrak atau perilaku aplikasi yang sedang berjalan.
