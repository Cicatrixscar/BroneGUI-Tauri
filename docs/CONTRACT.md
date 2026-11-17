# Kontrak pesan: tim LLM -> connector -> GUI

STATUS: MQTT. Transport diputuskan lewat audit integrasi 11 November 2026. Kontrak internal di bawah tetap berlaku; format mentah LLM diterjemahkan oleh adapter di bagian berikut.

## Ingress MQTT dari `brone-talk` (`robot/#`)

Broker Mosquitto berjalan di Jetson (`0.0.0.0:1883`). LLM di NUC mengirim format mentah berikut. Backend Rust (`src-tauri/src/connector/protocol.rs`) menerjemahkannya ke kontrak internal GUI sebelum validasi.

| Topik | Payload LLM | Terjemahan GUI |
|---|---|---|
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

Catatan: `brone-talk` belum mengirim jadwal viseme. Default: `bicara=mulai` tidak membuat gerakan mulut; mulut mengikuti bentuk ekspresi aktif. Tersedia fallback mulut sintetis di `src/js/connector.js`, tetapi nonaktif default. Aktifkan `bicara.fallbackMulutAktif: true` hanya bila viseme dinamis gagal. Fallback mulai dari bentuk mulut ekspresi aktif, lalu mengganti vokal `A/I/U/E/O` setiap `fallbackIntervalMs`, dan berhenti saat `bicara=selesai` atau setelah `fallbackWatchdogMs`.

Topik lama `brone/face/ekspresi`, `brone/face/viseme`, dan `brone/face/bicara` tetap diterima untuk uji manual dengan kontrak internal di bawah.

Sumber pesan adalah tim LLM. Mode bawaan menerima jadwal timestamp viseme. Mode streaming opsional menerima kata dan menghasilkan viseme lokal; lihat aturan di bawah.

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

## Streaming kata opsional

Aktifkan `bicara.visemeMode: "streaming"` pada `src/config/config.json`, atau tekan **F4 saat mode dinamis** untuk berputar Bawaan -> Streaming kata -> Fallback mulut. F2 tetap mengganti dinamis/statis; F3 tetap mengatur panel statis. Pilihan lain: `bawaan` (default, streaming mati) dan `fallback` (vokal sintetis). Pilihan panel berlaku sampai aplikasi ditutup. Pergantian pilihan membatalkan seluruh timer mulut dan hold sebelumnya.

| Topik MQTT | Payload | Event internal |
|---|---|---|
| `robot/expression` | `{"expression":"happy","duration":6.0}` | Ekspresi + mulai bicara; durasi menjadi batas master streaming |
| `robot/word` | `{"word":"belum"}` | `brone://word` dengan `{"tipe":"word","word":"belum"}` |
| `robot/voice_stage` | `{"stage":"tts","state":"end"}` | Selesai bicara |

`word` wajib string tidak kosong, maksimal 256 karakter, tanpa karakter kontrol. Token tidak didukung (misalnya angka) diabaikan parser. Ejaan per huruf hanya untuk 2-5 huruf kapital penuh. Tidak perlu mengirim batas suku kata; tanda hubung eksplisit tetap diterima.

Kata baru langsung memotong kata lama. Setelah kata selesai, mulut REST sambil menunggu. Batas durasi atau pesan akhir mengembalikan DIAM, menahan ekspresi 5000 ms, lalu idle. Tanpa keduanya, GUI memakai timeout keheningan dan watchdog lokal. Pesan akhir berulang tidak memulai ulang hold. Kata terlambat setelah penutupan keras diabaikan sampai sesi baru dimulai.

Untuk kompatibilitas, adapter tetap mengirim `durasi_ms` ekspresi dan `durasi_s` mulai bicara. Streaming memakai durasi itu sebagai batas audio, bukan timer reset ekspresi. Sumber yang tidak dipilih tidak memengaruhi mulut/hold streaming. Detail parameter dan kompromi heuristik ada di `docs/rekap-ide-baru-viseme-streaming.md` bagian 5.

Uji browser: POST `/api/word` dengan `{"word":"belum"}`, atau POST `/api/message` memakai kontrak internal. Bridge MQTT development juga menerima tiga topik `robot/` di atas.
