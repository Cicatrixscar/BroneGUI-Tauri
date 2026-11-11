# Kontrak pesan: tim LLM -> connector -> GUI

STATUS: DRAFT. Transport belum diputuskan (lihat PRD Q1, menunggu tim LLM).

Sumber semua pesan adalah tim LLM. Tim LLM mengirim JSON yang sudah berisi timestamp dan viseme. GUI tidak mengubah fonem menjadi viseme.

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
| `berpikir` | BRONE_FACE_THINKING | Efek tanda tanya |
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
