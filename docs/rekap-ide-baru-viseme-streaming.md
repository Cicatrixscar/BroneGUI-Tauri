# Spesifikasi Desain: Streaming Word-by-Word Viseme & Kalibrasi Empiris

Dokumen ini adalah **spesifikasi teknis implementasi** integrasi sinkronisasi gerak bibir (*viseme*) berbasis *Streaming Word-by-Word Preemption* antara **Engine LLM/TTS (Intel NUC)** dan **BroneGUI-Tauri (Jetson Orin Nano)**.

Dokumen ini ditujukan sebagai panduan teknis langsung bagi developer yang akan mengimplementasikan modul di sisi GUI maupun LLM.

---

## 1. Arsitektur Komunikasi & Topik MQTT

Sistem menggunakan 2 tahap komunikasi:
1. **Set Ekspresi & Durasi Total (Awal Kalimat):** Menentukan bentuk mata, overlay emosi, dan batas waktu master.
2. **Streaming Kata (Saat Audio Dimainkan):** Mengalirkan teks kata demi kata secara real-time.

### A. Topik MQTT

| Topik | Frekuensi | Contoh Payload | Keterangan |
|---|---|---|---|
| **`robot/expression`** | 1x di awal kalimat | `{"expression": "happy", "duration": 6.0}` | Mengeset emosi dan batas waktu audio total. |
| **`robot/word`** | Per kata (saat audio kata dimainkan) | `{"word": "belum"}` | Memicu animasi bibir kata tersebut secara langsung. |
| **`robot/voice_stage`** | 1x di akhir kalimat | `{"stage": "tts", "state": "end"}` | Penanda selesai audio untuk menutup mulut ke `DIAM`. |

### B. Diagram Alur Sistem (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor LLM as Engine LLM / TTS (NUC)
    participant Rust as Tauri Rust (rumqttc)
    participant JS as Frontend GUI (WebKitGTK)
    actor Screen as Layar Robot (Face SVG)

    LLM->>Rust: MQTT robot/expression { "expression": "happy", "duration": 6.0 }
    Rust->>JS: Emit brone://ekspresi
    JS->>Screen: Wajah berganti ke "happy", buka master timer 6.0s

    loop Aliran Kata demi Kata (Streaming Words)
        LLM->>Rust: MQTT robot/word { "word": "be-lum" }
        Rust->>JS: Emit brone://word
        JS->>JS: Pecah suku kata & alokasikan budget 150ms
        JS->>Screen: Mouth Morphing meliuk sesuai viseme
        Note over JS,Screen: Jika kata baru masuk duluan, kata lama langsung dipotong (preempt).<br/>Jika ada jeda, mulut bertahan di REST (katup rileks).
    end

    LLM->>Rust: MQTT robot/voice_stage { "stage": "tts", "state": "end" }
    Rust->>JS: Emit brone://bicara { "status": "selesai" }
    JS->>Screen: Mulut kembali ke bentuk default ekspresi (DIAM)
    Note over JS,Screen: Post-Speech Hold Timer 5.0 Detik
    JS->>Screen: Wajah kembali ke ekspresi netral (idle)
```

---

## 2. Validasi Data Empiris (10 Sampel Suara TTS UB)

Konstanta waktu gerak suku kata dihitung secara matematis dari **10 sampel riil keluaran suara Text-to-Speech (TTS) UB**:

| No | Sampel Teks Percakapan | Durasi Total ($t$) | Jumlah Suku Kata ($S$) | Rata-rata per Suku Kata ($\Delta t$) | Kecepatan Bicara ($S/t$) |
|:--:|---|:--:|:--:|:--:|:--:|
| **1** | *"saat ini belum ada informasinya..."* | 6 s | 32 | **0.187 s** (187.5 ms) | 5.33 syl/s |
| **2** | *"FIA berawal dari fakultas administrasi..."* | 24 s | 155 | **0.155 s** (154.8 ms) | 6.46 syl/s |
| **3** | *"perpustakaan pusat UB terakreditasi A..."* | 13 s | 78 | **0.167 s** (166.7 ms) | 6.00 syl/s |
| **4** | *"di UB ada kantor cabang bank BCA..."* | 6 s | 31 | **0.193 s** (193.5 ms) | 5.17 syl/s |
| **5** | *"Sejak dua Mei dua ribu dua puluh enam..."* | 24 s | 148 | **0.162 s** (162.2 ms) | 6.17 syl/s |
| **6** | *"kantor rektor berada di gedung rektorat..."* | 3 s | 19 | **0.158 s** (157.9 ms) | 6.33 syl/s |
| **7** | *"dekan fakultas kedokteran hewan adalah..."* | 7 s | 51 | **0.137 s** (137.3 ms) | 7.29 syl/s |
| **8** | *"kampus dieng UB berada di jalan puncak..."* | 9 s | 58 | **0.155 s** (155.2 ms) | 6.44 syl/s |
| **9** | *"UB menyediakan beasiswa dari pemerintah..."* | 11 s | 72 | **0.153 s** (152.8 ms) | 6.55 syl/s |
| **10** | *"dies natalis UB diperingati setiap lima..."* | 12 s | 86 | **0.140 s** (139.5 ms) | 7.17 syl/s |
| **Σ** | **Total Pengujian Keseluruhan** | **115 s** | **730** | **0.1575 s (157.5 ms)** | **6.35 syl/s** |

### Perhitungan Rata-rata Tertimbang (*Weighted Mean*):
$$\bar{t}_{\text{suku kata}} = \frac{\sum \text{Durasi Total}}{\sum \text{Suku Kata}} = \frac{115\text{ detik}}{730\text{ suku kata}} \approx \mathbf{0.1575\text{ detik}}\ (\mathbf{157.5\text{ ms}})$$

👉 **Konstanta Emas Desain:** Ditetapkan **`150 ms` per suku kata** sebagai basis acuan waktu animasi.

---

## 3. Algoritma Pemecah Kata & Pemetaan Fonetik (GUI)

Ketika sebuah string kata diterima via payload `robot/word`, fungsi pemecah kata menjalankan 4 tahap logika:

### Tahap 1: Pembersihan Tanda Baca
Pisahkan tanda baca penutup (`,`, `.`, `!`, `?`):
* Jika kata mengandung tanda baca jeda (koma `,` atau titik `.`), jadwalkan jeda katup nafas `REST` selama **`150 – 200 ms`** setelah kata selesai.

---

### Tahap 2: Deteksi Akronim / Singkatan (All-Caps Spell-Out)
Jika kata terdiri dari **2 – 5 huruf dan semuanya huruf kapital** (misal: `"BCA"`, `"UB"`, `"ATM"`, `"FIA"`), kata dieja per-huruf dengan kamus abjad Indonesia:

| Huruf | Bunyi Ejaan | Viseme & Alokasi Waktu (Budget 150 ms per huruf) |
|:--:|:--:|---|
| **`A`** | *"a"* | **`A`** (150 ms) |
| **`B`** | *"be"* | **`REST`** (45 ms) $\rightarrow$ **`E`** (105 ms) |
| **`C`** | *"ce"* | **`E`** (150 ms) |
| **`D`** | *"de"* | **`E`** (150 ms) |
| **`E`** | *"e"* | **`E`** (150 ms) |
| **`F`** | *"ef"* | **`E`** (150 ms) |
| **`G`** | *"ge"* | **`E`** (150 ms) |
| **`H`** | *"ha"* | **`A`** (150 ms) |
| **`I`** | *"i"* | **`I`** (150 ms) |
| **`J`** | *"je"* | **`E`** (150 ms) |
| **`K`** | *"ka"* | **`A`** (150 ms) |
| **`L`** | *"el"* | **`E`** (150 ms) |
| **`M`** | *"em"* | **`E`** (105 ms) $\rightarrow$ **`REST`** (45 ms) |
| **`N`** | *"en"* | **`E`** (150 ms) |
| **`O`** | *"o"* | **`O`** (150 ms) |
| **`P`** | *"pe"* | **`REST`** (45 ms) $\rightarrow$ **`E`** (105 ms) |
| **`Q`** | *"ki"* | **`I`** (150 ms) |
| **`R`** | *"er"* | **`E`** (150 ms) |
| **`S`** | *"es"* | **`E`** (150 ms) |
| **`T`** | *"te"* | **`E`** (150 ms) |
| **`U`** | *"u"* | **`U`** (150 ms) |
| **`V`** | *"fe"* | **`E`** (150 ms) |
| **`W`** | *"we"* | **`E`** (150 ms) |
| **`X`** | *"eks"* | **`E`** (150 ms) |
| **`Y`** | *"ye"* | **`E`** (150 ms) |
| **`Z`** | *"zet"* | **`E`** (150 ms) |

*Contoh Eksekusi `"BCA"`:*
* `B` (REST 45ms $\rightarrow$ E 105ms) + `C` (E 150ms) + `A` (A 150ms) = **Total 450 ms (3 suku kata)**.

---

### Tahap 3: Pemecahan Suku Kata Kata Biasa & Budget Sharing (150 ms)
Untuk kata reguler, suku kata dihitung berdasarkan huruf vokal (`a, i, u, e, o`). Setiap 1 suku kata memiliki jatah budget **150 ms**:

1. **Suku Kata Biasa (Non-Bilabial, misal *"sa"* atau *"da"*):**
   * Vokal langsung mendapat **`150 ms`** penuh.
2. **Suku Kata dengan Konsonan Bilabial Onset (`P, B, M` di awal, misal *"be"*):**
   * `REST` (katup bibir merapat kilat) $\rightarrow$ **`45 ms`**
   * Vokal `E` (bibir membuka) $\rightarrow$ **`105 ms`**
   * *(Total = 150 ms)*
3. **Suku Kata dengan Konsonan Bilabial Koda (`P, B, M` di akhir, misal *"lum"*):**
   * Vokal `U` (bibir membulat) $\rightarrow$ **`105 ms`**
   * `REST` (katup bibir penutup M) $\rightarrow$ **`45 ms`**
   * *(Total = 150 ms)*

#### Simulasi Riil Kata *"Be-lum"* (Total 2 Suku Kata = 300 ms):
* Suku kata 1 (*"be"*): `REST` (45 ms) $\rightarrow$ `E` (105 ms) = 150 ms
* Suku kata 2 (*"lum"*): `U` (105 ms) $\rightarrow$ `REST` (45 ms) = 150 ms
* **Total waktu kata tepat 300 ms.**

---

### Tahap 4: Vokal Identik Berurutan

Vokal identik berurutan selalu memakai perpanjangan +100 ms per vokal ekstra, termasuk pada kata biasa. Contoh: `haloo` = A 150 ms + O 250 ms; `saat` = A 250 ms; `maaf` = REST 45 ms + A 205 ms.

Tidak ada micro-REST di antara vokal identik. Viseme identik yang bersebelahan digabung agar bentuk mulut stabil. Aturan ini adalah pendekatan visual sederhana, bukan pembedaan fonetik vokal panjang dan dua suku kata. Tanda hubung eksplisit tetap menjadi batas suku kata.

---

## 4. Mekanisme State & Preemption Runtime (Execution Engine)

1. **Preemption Instan (Kata Baru Memotong Kata Lama):**
   * Jika kata baru tiba saat kata sebelumnya masih beranimasi, timer kata sebelumnya **langsung dibatalkan**.
   * Animasi kata baru langsung dimulai secara mulus berkat modul *Mouth Morphing* vektor SVG.
2. **Jeda Antar-Kata & Jitter Buffer Jaringan:**
   * Jika kata lama sudah selesai tetapi kata berikutnya belum tiba (akibat jeda nafas atau latensi transmisi), mulut **otomatis bertahan di posisi `REST` (katup rileks)**.
   * **Robot tidak akan pernah "mangap melongo"** saat jeda menunggu kata berikutnya.
3. **Penyelesaian Bicara & Post-Speech Hold:**
   * Saat sinyal `robot/voice_stage` (`tts: end`) diterima atau durasi total tercapai:
     * Mulut kembali ke bentuk default ekspresi aktif (**`DIAM`**).
     * Memulai countdown **Hold 5 detik (`5000 ms`)**.
     * Setelah 5 detik penuh tanpa interupsi, ekspresi kembali ke **`idle`**.

---

## 5. Keputusan Implementasi Modular

Keputusan berikut menggantikan aturan yang bertentangan pada contoh rancangan di atas.

- Pilihan `bicara.visemeMode`: `bawaan`, `streaming`, atau `fallback`. Default `bawaan`; streaming nonaktif sampai dipilih. Hanya sumber terpilih yang mengendalikan mulut.
- Tekan **F4 di mode dinamis** untuk berputar Bawaan -> Streaming kata -> Fallback mulut. Indikator pilihan tampil 2 detik. F4 tidak mengganti dinamis/statis dan mengabaikan key repeat serta modifier. Dropdown pada panel F2 tetap tersedia sebagai pengaturan tambahan. Pilihan panel berlaku selama aplikasi berjalan; ubah konfigurasi untuk default saat startup.
- PBM mengambil budget suku kata: `belum` = REST 45 -> E 105 -> U 105 -> REST 45 = 300 ms. `bom` = REST 45 -> O 60 -> REST 45 = 150 ms.
- Vokal identik berurutan selalu diperpanjang +100 ms per karakter ekstra: `saat` = A 250 ms; `maaf` = REST 45 -> A 205 ms. Tidak ada micro-REST tambahan. Viseme identik bersebelahan digabung.
- Ejaan per huruf hanya untuk 2-5 huruf kapital penuh. `BCA` = REST 45 -> E 255 -> A 150 = 450 ms. Kata biasa yang dikirim kapital penuh juga akan dieja; pengirim harus mempertahankan kapitalisasi yang dimaksud.
- Parser memakai heuristik vokal tertulis dan pembagian konsonan antarvokal; tanda hubung dapat memberi batas suku kata eksplisit. Ini bukan transkripsi fonetik lengkap. Angka dan token tanpa vokal tidak menghasilkan animasi.
- Morph streaming menyesuaikan segmen: maksimal 60 ms untuk vokal, 25 ms untuk REST, dan maksimal 60% durasi segmen. Morph bawaan tetap 100 ms. Animasi mata saat pergantian ekspresi tidak boleh menimpa mulut streaming.
- `duration` dari ekspresi menjadi master deadline streaming. Kata berikutnya dan duplikasi `tts:start` tidak memperpanjang deadline tersebut. Adapter Rust tetap mempertahankan `durasi_ms` untuk kompatibilitas mode bawaan; mode streaming menafsirkannya sebagai batas sesi audio dan melewati reset ekspresi lama.
- `tts:end` dapat menyelesaikan sesi lebih awal. Selesai bersifat idempoten: timer kata dibatalkan, DIAM, hold 5000 ms, lalu idle. Kata terlambat setelah penutupan eksplisit/master deadline diabaikan sampai awal sesi baru.
- Tanpa durasi, setelah kata selesai masuk REST; keheningan pesan kata 1200 ms mengakhiri sesi sementara. Kata baru selama hold dapat melanjutkan sesi. Setelah hold habis, sesi ditutup. Watchdog 10000 ms menjadi batas keras sesi tanpa durasi.
- Berganti sumber atau mode statis/dinamis membatalkan timer sebelumnya. Modul bawaan, fallback, dan aset viseme lama tetap tersedia. Tidak ada perpindahan otomatis ke sumber lain.
- Kompatibilitas konfigurasi lama: `fallbackMulutAktif: true` tetap mengaktifkan fallback jika streaming/fallback belum dipilih eksplisit; jadwal asli masih dapat mengambil alih pada konfigurasi lama itu. Pemilihan melalui panel memakai isolasi mode baru.

### Parameter Kalibrasi

Parameter ada di `src/config/config.json` -> `bicara.streaming`: `syllableMs`, `bilabialMs`, `extraVowelMs`, `punctuationMs`, `silenceTimeoutMs`, `watchdogMs`, `morphMs`, `closureMorphMs`. Hold berada di `bicara.holdAfterSpeechMs`.

Rata-rata empiris 157,5 ms/suku kata menjadi dasar pemilihan budget 150 ms. Pembagian PBM, pemanjangan vokal, dan durasi morph merupakan setelan awal animasi, bukan pengukuran tambahan dari data audio tersebut. Timeout keheningan adalah pengaman lokal, bukan bukti audio telah selesai.

### Sumber Implementasi

- `src/js/wordViseme.js`: pemecah kata dan ejaan, tanpa timer.
- `src/js/visemeController.js`: preemption, deadline, keheningan, hold, dan watchdog streaming.
- `src/js/connector.js`: pemilihan sumber serta jalur bawaan/fallback yang tetap kompatibel.
- `tests/fe/wordViseme.test.js` dan `tests/fe/visemeController.test.js`: bukti parser dan lifecycle.
