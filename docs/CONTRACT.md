# Kontrak pesan: tim LLM -> connector -> GUI

STATUS: MQTT. Transport diputuskan lewat audit integrasi 11 November 2026. Kontrak internal di bawah tetap berlaku; format mentah LLM diterjemahkan oleh adapter di bagian berikut.

## Ingress MQTT dari `brone-talk` (`robot/#`)

Broker Mosquitto berjalan di Jetson (`0.0.0.0:1883`). LLM di NUC mengirim format mentah berikut. Backend Rust (`src-tauri/src/connector/ingress.rs`) memilih adapter berdasarkan topik dan menerjemahkannya ke kontrak internal GUI. Model dan aturan validasi internal tetap berada di `src-tauri/src/connector/protocol.rs`; transport MQTT berada di `src-tauri/src/connector/mqtt.rs`.

Paket streaming baru menggabungkan `expression`, `duration`, dan `sentence` dalam satu JSON di `robot/expression`. Adapter menghasilkan satu event `brone://sentence` agar ekspresi ikut antre bersama kalimat. Format lama tanpa `sentence` tetap menghasilkan event ekspresi, mulai bicara, lalu viseme sesuai payload; validasi format lama tetap per pesan. Jalur topik manual tetap membaca jenis pesan dari field `tipe` payload. Daftar subscription backend bersumber dari `ingress::DEFAULT_TOPICS`; `lib.rs` memakai daftar tersebut dan menimpa host/port dari environment. Gaze CV memiliki adapter terpisah seperti dijelaskan berikut.

## Gaze horizontal dari CV

CV publish ke `robot/gaze` tanpa retain:

```json
{"type":"gaze","x":0.5}
```

Payload wajib objek dengan tepat dua field: `type` harus string `gaze`, dan `x` menerima angka finite berapa pun. Backend meneruskan nilai asli; GUI membatasi target dengan `clamp(x, -1, 1)`. Misalnya `-5` menjadi target `-1`, `8` menjadi `1`, dan `0.5` tetap `0.5`. Field tambahan, nilai non-finite, string angka, boolean, null, field hilang, dan JSON rusak ditolak. Pesan gaze dengan retained flag diabaikan saat berlangganan ulang; aturan retained pesan LLM/TTS tetap seperti sebelumnya.

Adapter menerjemahkannya menjadi event Tauri `brone://gaze` dengan payload internal `{"tipe":"gaze","x":0.5}`. `x` adalah target absolut: `-1` kiri layar, `0` posisi dasar ekspresi, `1` kanan layar, dari sudut pandang orang yang melihat layar. Kedua gambar mata bergeser bersama; posisi Y dan jarak antar mata tetap. Pengirim kamera memetakan arah kamera ke arah layar.

GUI memakai `gaze.maxOffsetX: 20` satuan SVG pada viewBox dasar 800 x 480 dan `gaze.durationMs: 150` ms dengan easing ease-out kuadratik. Ini nilai awal kalibrasi, dapat diubah melalui config. Pesan terbaru mengganti target dari posisi gerakan saat ini; pesan dengan target sama tidak memulai ulang gerak. Target bertahan sampai pesan baru, termasuk setelah selesai bicara atau perubahan ekspresi. Reset eksplisit dengan `x:0`.

Gaze diproses terpisah dari timer emosi, antrean kalimat, serta viseme pada semua mode mulut. Selama ekspresi `cry`/`timeout` dan transisi yang melibatkannya, offset tampilan ditahan di tengah tanpa membuang target; target diterapkan kembali setelah keluar. Pergantian mode statis/dinamis mereset gaze langsung ke tengah. Pesan selama mode statis dibuang tanpa antrean.

Uji browser: POST `/api/message` dengan payload eksternal yang sama. Bridge mengembalikan HTTP 400 untuk gaze invalid dan tidak menyiarkannya. CLI: `node scripts/send.js gaze -1`, `node scripts/send.js gaze 0`, `node scripts/send.js gaze 1`. Jalur HTTP ini menguji bridge development dan frontend; jalur MQTT/Tauri tetap memerlukan uji pada runtime desktop. Detail dan perintah terminal ada di [rancangan-gaze-horizontal.md](rancangan-gaze-horizontal.md).

## Pemetaan pesan LLM/TTS

| Topik | Payload LLM | Terjemahan GUI |
|---|---|---|
| `robot/expression` | `{"expression":"happy","duration":3.5,"sentence":"Halo, apa kabar?"}` | Satu event kalimat + face state, diputar saat giliran kalimat dimulai |
| `robot/expression` | `{"expression":"idle"}` | `emosi=idle` |
| `robot/expression` | `{"expression":"happy"}` / `sad` | `emosi=happy` / `sad` |
| `robot/expression` | `{"expression":"neutral"}` | `emosi=idle` |
| `robot/expression` | `{"expression":"excited"}` | `emosi=happier` |
| `robot/expression` | `{"expression":"confused"}` | `emosi=confused` |
| `robot/expression` | `{"expression":"speaking","duration":4}` | `bicara=mulai` (`duration` detik dipakai sebagai `durasi_ms` untuk ekspresi lain) |
| `robot/voice_stage` | `{"stage":"llm","state":"start"}` | `emosi=confused` |
| `robot/voice_stage` | `{"stage":"error","state":"llm"}` | `emosi=timeout` |
| `robot/voice_stage` | `{"stage":"tts","state":"start"}` | `bicara=mulai` |
| `robot/voice_stage` | `{"stage":"tts","state":"end"}` | `bicara=selesai` |

Ekspresi LLM di luar tabel di atas ditolak dan dicatat di log. Nama `speaking` bukan emosi; GUI tidak mengganti ekspresi saat menerimanya.

Catatan: `brone-talk` belum mengirim jadwal viseme. Default: `bicara=mulai` tidak membuat gerakan mulut; mulut mengikuti bentuk ekspresi aktif. Tersedia fallback mulut sintetis di `src/js/connector.js`, tetapi nonaktif default. Aktifkan `bicara.fallbackMulutAktif: true` hanya bila viseme dinamis gagal. Fallback mulai dari bentuk mulut ekspresi aktif, lalu bergantian antara viseme `O` dan `REST` setiap `fallbackIntervalMs`, dan berhenti saat `bicara=selesai` atau setelah `fallbackWatchdogMs`.

Topik lama `brone/face/ekspresi`, `brone/face/viseme`, dan `brone/face/bicara` tetap diterima untuk uji manual dengan kontrak internal di bawah.

Sumber pesan adalah tim LLM. Mode bawaan menerima jadwal timestamp viseme. Mode streaming opsional menerima kalimat dan menghasilkan viseme lokal; lihat aturan di bawah.

## Pesan ekspresi

```json
{
  "tipe": "ekspresi",
  "id": "uuid-atau-counter",
  "emosi": "senang",
  "intensitas": 1.0,
  "durasi_ms": 2000
}
```

Nilai `emosi`:

| Nilai | Gambar acuan | Keterangan |
|---|---|---|
| `netral` | BRONE_FACE_BASE | Idle |
| `confused` (alias: `berpikir`) | BRONE_FACE_THINKING | Efek tanda tanya |
| `sedih` | BRONE_FACE_SAD | |
| `menangis` | BRONE_FACE_CRY | Efek air mata mengalir |
| `terkejut` | BRONE_FACE_SHOCK | Efek tanda seru |
| `senang` | BRONE_FACE_HAPPY | |
| `sangat_senang` | BRONE_FACE_HAPPIER | |
| `sangat_senang_transisi` | BRONE_FACE_HAPPIER (TRANSITION) | Sesaat, misalnya saat menyapa. Setelah `durasi_ms` habis, wajah kembali ke `sangat_senang` |
| `timeout` | BRONE_FACE_TIMEOUT | Mata spiral & mulut bergelombang |

`intensitas`: 0.0 sampai 1.0.

Efek (air mata, tanda seru, tanda tanya) mengikuti ekspresi. Tidak ada field efek terpisah.

## Pesan viseme

```json
{
  "tipe": "viseme",
  "id": "uuid-atau-counter",
  "jadwal": [
    { "t": 0.00, "v": "A" },
    { "t": 0.12, "v": "P_B_M" }
  ]
}
```

`t`: detik, dihitung dari saat audio mulai diputar (usulan, lihat PRD Q26).

`v`:

### Viseme Dinamis Inti (Vokal + REST)

| Nilai | Keterangan & Karakteristik |
|---|---|
| `A` | Vokal A (mulut terbuka lebar vertikal) |
| `I` | Vokal I (mulut melebar pipih horizontal) |
| `U` | Vokal U (mulut mengerucut bulat kecil) |
| `E` | Vokal E (mulut terbuka sedang agak melebar) |
| `O` | Vokal O (mulut bulat lonjong besar) |
| `REST` | Posisi istirahat / katup bibir rapat bilabial (B, P, M) |
| `DIAM` | Mulut kembali ke bentuk default ekspresi yang sedang aktif |

*(Kode lama seperti `P_B_M`, `I_G`, `TH`, `N_L`, dll. tetap diterima untuk kompatibilitas mundur).*

## Pesan bicara

```json
{ "tipe": "bicara", "status": "mulai" }
{ "tipe": "bicara", "status": "selesai" }
```

## Aturan

- Pesan yang tidak sesuai kontrak dibuang oleh BE dan dicatat di log. Tidak diteruskan ke FE.
- Pesan yang datang saat mode statis dibuang, tidak diantre (PRD Q14).
- Viseme yang `t`-nya sudah lewat saat diterima dilewati, tidak dimainkan mundur.
- Jadwal kosong atau habis: mulut kembali ke `DIAM`.

## Streaming kalimat opsional: kontrak untuk tim LLM/TTS

Aktifkan `bicara.visemeMode: "streaming"` pada `src/config/config.json`, atau tekan **F4 saat mode dinamis** untuk berputar Bawaan -> Streaming kalimat -> Fallback mulut. F2 tetap mengganti dinamis/statis; F3 tetap mengatur panel statis. Pilihan lain: `bawaan` (default, streaming mati) dan `fallback` (vokal sintetis). Pilihan panel berlaku sampai aplikasi ditutup. Pergantian pilihan membatalkan seluruh timer mulut dan hold sebelumnya.

| Topik MQTT | Payload | Event internal |
|---|---|---|
| `robot/expression` (utama) | `{"expression":"happy","duration":3.5,"sentence":"Halo, apa kabar?"}` | `brone://sentence` dengan `tipe: "sentence"` dan ketiga field yang sama; alias ekspresi dinormalisasi |
| `robot/sentence` (alternatif) | JSON gabungan yang sama | Event kalimat yang sama; gunakan salah satu topik saja |
| `robot/voice_stage` (opsional) | `{"stage":"tts","state":"end"}` | Hentikan sesi dan batalkan antrean tersisa |

Kirim satu JSON per kalimat, dengan ketiga field wajib berikut. Tidak perlu field `tipe`, `face_state`, `word`, atau jadwal viseme pada payload MQTT ini.

```json
{
  "expression": "happy",
  "duration": 3.5,
  "sentence": "Halo, apa kabar?"
}
```

| Field | Tipe dan aturan |
|---|---|
| `expression` | String ekspresi wajah: `idle`, `happy`, `happier`, `happier_transisi`, `sad`, `cry`, `shock`, `confused`, atau `timeout`. Alias lama tetap diterima, misalnya `neutral` menjadi `idle`, `excited` menjadi `happier`, `thinking` menjadi `confused`. `speaking` bukan ekspresi untuk paket kalimat. |
| `duration` | Number, durasi audio TTS **kalimat ini** dalam detik, harus `> 0` dan `<= 3600`. Contoh 3500 ms dikirim sebagai `3.5`, bukan `3500` atau `"3.5"`. Ambil durasi dari hasil TTS, bukan perkiraan LLM. |
| `sentence` | String teks kalimat yang sama dengan audio TTS, tidak kosong, maksimal 4096 karakter, tanpa karakter kontrol seperti newline/tab. |

GUI mengantrekan seluruh paket. Ekspresi berubah saat giliran kalimat mulai, bukan saat paket yang masih mengantre diterima. GUI memecah teks menjadi kata dan membuat viseme lokal, termasuk jeda tanda baca, lalu menyesuaikan total durasinya ke `duration`. Kalimat berikutnya mulai setelah durasi kalimat sebelumnya selesai. Setelah paket terakhir selesai, mulut DIAM, ekspresi ditahan 5000 ms, kemudian idle. Paket gabungan baru memulai sesi secara otomatis, termasuk setelah kembali idle; tidak wajib mengirim pesan mulai/selesai terpisah.

Publish saat audio kalimat mulai diputar. Jika mengirim beberapa paket lebih awal, pemutar audio harus memakai urutan dan durasi yang sama tanpa jeda tambahan. Pesan gabungan ini tidak membawa timestamp absolut atau audio; ketepatan fonem masih berbasis heuristik ejaan. Angka/simbol belum diucapkan oleh parser; sebaiknya gunakan teks yang sudah dinormalisasi untuk TTS. Ejaan per huruf berlaku untuk 2-5 huruf kapital penuh. Kata individual dibatasi 256 karakter. Teks tanpa viseme yang didukung tetap menampilkan ekspresi dan mulut REST selama durasinya.

Pengaturan pengirim: broker MQTT Jetson pada port TCP `1883`, host memakai alamat IP/hostname Jetson yang dapat diakses NUC. Gunakan payload JSON UTF-8, `retain=false`, dan QoS publish `0`. Paket adalah perintah putar yang tidak memiliki ID deduplikasi; jangan publish paket yang sama ke kedua topik atau mengirim ulang paket yang sudah dimainkan. QoS 0 berarti tidak ada jaminan pengiriman. Subscriber backend tetap meminta QoS 1; QoS efektif mengikuti nilai lebih rendah dari publish/subscription.

Contoh publish (ganti `IP_JETSON`):

```sh
mosquitto_pub -h IP_JETSON -p 1883 -q 0 -t robot/expression -m '{"expression":"happy","duration":3.5,"sentence":"Halo, apa kabar?"}'
```

`robot/voice_stage` tetap tersedia untuk status sistem. Jika digunakan, kirim `tts/start` sebelum paket pertama dan `tts/end` hanya setelah seluruh audio selesai; `tts/end` membatalkan sisa antrean. Jangan kirim ekspresi terpisah untuk tiap paket kalimat karena jalur ekspresi lama menginterupsi antrean yang sedang berjalan.

Kompatibilitas: format ekspresi lama tanpa `sentence`, `robot/word`, `brone://word`, dan `/api/word` tetap tersedia. Format antara `{"sentence":"..."}` tanpa `expression` dan `duration` diganti oleh kontrak tiga field di atas. Paket streaming gabungan hanya dimainkan saat mode `streaming` dipilih; mode bawaan/fallback dan mode statis mengabaikannya.

Uji browser: POST `/api/sentence`, `/api/ekspresi`, atau `/api/message` dengan JSON gabungan di atas. Bridge menambahkan `tipe: "sentence"` secara otomatis. Untuk pengiriman internal Tauri/manual, gunakan `{"tipe":"sentence","expression":"happy","duration":3.5,"sentence":"Halo, apa kabar?"}`. Bridge MQTT development menerima paket gabungan melalui kedua topik yang didukung.
