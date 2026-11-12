# 📋 LAPORAN AUDIT INTEGRASI KOMUNIKASI MQTT: SISTEM SUARA/LLM (`brone-talk`) ↔ DISPLAY EXPRESSION GUI (2 VERSI)

**Disusun oleh:** Fatar (QC / System Performance & Integration Evaluator BRONE)  
**Tanggal Audit:** 11 November 2026  
**Tujuan Dokumen:** Laporan teknis temuan lapangan dan ketidakcocokan kode agar tim pengembang **LLM** dan **Display Expression GUI** dapat menyinkronkan protokol, menyalakan broker MQTT, dan memastikan animasi ekspresi bekerja sebelum masuk tahap *uji multiprogramming QC*.

> **Revisi 12 November 2026 (tim GUI v2):** Adapter `robot/#` sudah diterapkan di `BroneGUI-Tauri`. Isi Temuan #2–#4 di bawah tetap menggambarkan kondisi **saat audit 11 November 2026**. Status implementasi terbaru ada di **Bagian 7**. Uji MQTT langsung di robot belum dilakukan.

---

## 1. Ringkasan Eksekutif & Status Keseluruhan

Audit dilakukan terhadap kondisi perangkat nyata (**Intel NUC 12** & **NVIDIA Jetson Orin Nano**) serta kode terbaru ketiga repositori per **11 November 2026**:

| Modul | Repositori & Commit Terverifikasi | Peran Saat Ini | Status Siap Pakai Bersama |
| :--- | :--- | :--- | :--- |
| **MQTT Broker (`mosquitto`)** | Paket `mosquitto 2.0.11` di **Jetson (`0.0.0.0:1883`)** | **Broker Pusat** *(aktif `pid=1140`, tanpa `mosquitto.service`)* | ✅ **Broker SUDAH HIDUP di LAN `1883`** *(tinggal cek unit `Requires=` & auth)* |
| **Voice & LLM Engine** | `yukienjoyer7/brone-talk-nuc` (`eebea7a`)<br>*(& pembanding `brone_talk` `cd6764f`)* | **MQTT Publisher** *(output-only)* di Intel NUC | ⚠️ Sudah mengarah ke `192.168.100.2:1883`, tapi format JSON belum cocok GUI |
| **Expression GUI v1**<br>*(React + FastAPI)* | `Thoriqfm/brone-gui-new` (`cc46a05`) | **MQTT Subscriber** $\rightarrow$ WebSocket $\rightarrow$ Browser | ❌ **Ditolak validasi** (format JSON & beberapa nama emosi tidak cocok) |
| **Expression GUI v2**<br>*(Rust Tauri v2)* | `Cicatrixscar/BroneGUI-Tauri` (`3b5e8df`) | **MQTT Subscriber** langsung ke UI SVG | ⚠️ **Adapter `robot/#` sudah diterapkan (12 Nov 2026)**; menunggu uji MQTT langsung |

**Kesimpulan Utama:**  
Broker MQTT di Jetson **sudah aktif di `0.0.0.0:1883`**, sehingga dari sisi jaringan tidak perlu install broker baru. Namun, jika **LLM** dan salah satu **Expression GUI** dijalankan bersamaan saat ini, **ekspresi wajah robot TIDAK akan berubah secara otomatis** karena ditemukan **4 masalah konkret**:
1. **`mosquitto.service` tidak terdaftar di `systemd`** meskipun daemon `mosquitto` hidup (`pid=1140`) — template service GUI yang memakai `Requires=mosquitto.service` akan gagal start, dan GUI v1 harus diarahkan tanpa menyalakan broker kedua.
2. **Nama topik MQTT berbeda** antara LLM dan GUI versi Tauri.
3. **Struktur JSON payload berbeda** antara output LLM dengan kedua versi GUI *(semuanya pasti ditolak oleh parser masing-masing GUI)*.
4. **Daftar nama emosi & status bicara tidak seragam** *(4 dari 7 nilai ekspresi LLM tidak dikenali oleh kedua GUI)*.

**Status per 12 November 2026 (GUI v2):** poin 1 (baris `Requires=mosquitto.service`) sudah dihapus dari unit GUI. Poin 2–4 sudah ditangani di sisi GUI v2 dengan adapter `robot/#` (topik, payload, dan mapping emosi). Verifikasi jaringan/auth broker serta uji MQTT langsung di robot **belum** dilakukan.

---

## 2. Temuan #1 — Infrastruktur Broker MQTT (Broker Aktif di `0.0.0.0:1883`, Tapi Tanpa `mosquitto.service`)

### Fakta Lapangan (Hasil Cek Langsung di NUC & Jetson, 11 Nov 2026)
1. Pengecekan systemd di **Intel NUC** & **Jetson**:
   ```bash
   sudo systemctl status mosquitto
   # Output: Unit mosquitto.service could not be found.
   ```
2. Pengecekan paket & port aktif di **NVIDIA Jetson Orin Nano**:
   ```text
   dpkg -l | grep -i mosquitto
   -> mosquitto 2.0.11-1ubuntu1.2 (arm64) & mosquitto-clients SUDAH TERPASANG

   sudo ss -tulpn | grep 1883
   -> tcp LISTEN 0 100 0.0.0.0:1883 0.0.0.0:* users:(("mosquitto",pid=1140,fd=5))
   ```

### Analisis & Dampak ke Integrasi
* **Kabar Baik — Broker Pusat SUDAH Siap Pakai di Jetson:** `mosquitto` di Jetson sudah mendengarkan di `0.0.0.0:1883` (semua interface jaringan, bukan cuma `127.0.0.1`). Artinya alamat default LLM di NUC (`BRONE_MQTT_BROKER=192.168.100.2`, port `1883`) sudah mengarah ke target yang hidup — **jangan menjalankan/menginstall broker kedua** agar port `1883` tidak bentrok.
* **Peringatan untuk Tim GUI (`systemd` unit):** Karena `mosquitto` (`pid=1140`) berjalan **tanpa unit sistem bernama `mosquitto.service`** (kemungkinan dari skrip startup/service kustom atau proses non-`mosquitto.service`), **JANGAN memakai baris `Requires=mosquitto.service`** di file unit `brone-gui.service` (seperti pada contoh `BroneGUI-Tauri/docs/DEPLOY.md` baris 339), karena `systemd` akan menolak menjalankan GUI dengan error unit tidak ditemukan.
* **Yang Perlu Diverifikasi Singkat di Jetson:** Cek izin akses anonim / ACL listener (`cat /etc/mosquitto/conf.d/*.conf`) serta pastikan dari NUC bisa terhubung (`nc -zv 192.168.100.2 1883` dan tes `mosquitto_pub`/`mosquitto_sub`). *(Cek juga `ps -fp 1140` / `systemctl status 1140` untuk tahu bagaimana proses `mosquitto` otomatis hidup saat boot).*

---

## 3. Temuan #2 & #3 — Ketidakcocokan Topik MQTT & Format JSON (*Kondisi 11 Nov: 100% Ditolak Parser*)

Perbandingan langsung antara pesan yang **diterbitkan LLM** (`brone_talk.py` baris 143–157; `docs/mqtt-contract.md` baris 11–17) dengan pesan yang **wajib diterima** oleh kedua GUI:

### A. Perbandingan Topik MQTT
| Pengirim / Penerima | Topik Ekspresi Utama | Topik Status / Tahap Berpikir & Bicara | Kecocokan dengan LLM |
| :--- | :--- | :--- | :---: |
| **LLM (`brone-talk-nuc`)** | `robot/expression` | `robot/voice_stage`, `robot/voice_status`, `robot/vad_status` | *(Sumber Data)* |
| **GUI v1 (`brone-gui-new`)** | `robot/expression` *(default `BRONE_MQTT_TOPIC`)* | ❌ Tidak berlangganan `robot/voice_stage` / `vad_status` | **Topik utama COCOK**, topik stage belum dibaca |
| **GUI v2 (`BroneGUI-Tauri`)** | `robot/expression` *(via adapter)* | `robot/voice_stage` *(via adapter)*; `brone/face/viseme` tetap untuk uji manual | ✅ **Adapter sudah diterapkan 12 Nov 2026** |

### B. Perbandingan Struktur JSON Payload
1. **Yang dikirim oleh LLM (`brone-talk-nuc/brone_talk.py` baris 152–156):**
   ```json
   {"expression": "idle"}
   {"expression": "speaking", "duration": 4}
   {"expression": "happy"}
   ```
   Dan tahap proses ke topik `robot/voice_stage`:
   ```json
   {"stage": "llm", "state": "start", "ts": 1762860000.12, ...}
   {"stage": "tts", "state": "start", "ts": 1762860003.45}
   ```

2. **Yang diwajibkan GUI v1 (`brone-gui-new/backend/app/schemas/messages.py` baris 6–27):**
   Menggunakan Pydantic **`strict=True, extra='forbid'`**. Payload wajib berbentuk:
   ```json
   {
     "type": "SET_EXPRESSION",
     "request_id": "talk-001",
     "payload": {
       "emotion": "happy",
       "intensity": 1,
       "transition_ms": 700
     }
   }
   ```
   *(Catatan: `intensity` & `transition_ms` opsional pada ingress).*  
   **Dampak saat menerima JSON LLM:** Langsung ditolak oleh `mqtt_ingress.py` (baris 112–118) dengan log **`MQTT command rejected: invalid SET_EXPRESSION JSON`**.

3. **Yang diwajibkan GUI v2 (`BroneGUI-Tauri/src-tauri/src/connector/protocol.rs` baris 40–63):**
   Menggunakan Rust Serde **`#[serde(tag = "tipe")]`**. Payload wajib berbentuk:
   ```json
   {"tipe": "ekspresi", "emosi": "happy", "durasi_ms": 4000}
   ```
   Atau untuk animasi bicara/viseme:
   ```json
   {"tipe": "bicara", "status": "mulai"}
   {"tipe": "viseme", "jadwal": [{"t": 0.0, "v": "A"}, {"t": 0.15, "v": "O"}]}
   ```
   **Dampak saat menerima JSON LLM:** Langsung gagal *deserialize* di `mqtt.rs` (baris 71–97) karena tidak memiliki tag `"tipe"` dan field `"emosi"`.

   **Status 12 November 2026:** `mqtt.rs` sekarang memilih adapter berdasarkan topik. Payload `robot/expression` dan `robot/voice_stage` diterjemahkan ke `Pesan` internal sebelum validasi; kontrak `tipe/emosi` lama tetap diterima di topik `brone/face/*` untuk uji manual.

---

## 4. Temuan #4 — Ketidakcocokan Nama Ekspresi & Status Hidup (*Thinking / Speaking / Timeout*)

Selain topik dan struktur JSON, daftar **nilai ekspresi** yang dipakai LLM berbeda dengan *whitelist* yang diizinkan kedua GUI:

### Tabel Pemetaan Ekspresi (3 Repositori)
| Nilai yang Dikirim LLM<br>*(`brone_talk.py#L1366, L1801, L1917`)* | Kapan LLM Mengirimkannya? | Dikenal `brone-gui-new`?<br>*(`messages.py#L4`)* | Dikenal `BroneGUI-Tauri`?<br>*(kondisi audit 11 Nov)* | Rekomendasi Mapping yang Benar |
| :--- | :--- | :---: | :---: | :--- |
| `"idle"` | Selesai warmup, standby, service stop | ✅ Ya | ✅ Ya | $\rightarrow$ **`idle`** |
| `"happy"` | Jawaban ramah / konfirmasi | ✅ Ya | ✅ Ya | $\rightarrow$ **`happy`** |
| `"sad"` | Konteks jawaban sedih | ✅ Ya | ✅ Ya | $\rightarrow$ **`sad`** |
| `"neutral"` | Default ekspresi jawaban biasa | ❌ **DITOLAK** | ✅ **Adapter → `idle`** | $\rightarrow$ **`idle`** *(bukan `netral` di GUI v1)* |
| `"excited"` | Jawaban antusias / bersemangat | ❌ **DITOLAK** | ✅ **Adapter → `happier`** | $\rightarrow$ **`happier`** |
| `"confused"` | Tidak paham / STT sampah / error jawab | ❌ **DITOLAK** | ✅ **Adapter → `shock`** | $\rightarrow$ **`shock`** atau **`thinking`** |
| `"speaking"` | Tepat sebelum TTS memutar suara ke speaker | ❌ **DITOLAK** | ✅ **Adapter → `bicara mulai`** | • **GUI v1:** Tahan emosi jawaban / `happy`<br>• **GUI v2:** Kirim `{"tipe":"bicara","status":"mulai"}` (dan `"selesai"` saat audio selesai) |
| *(Belum dikirim sebagai `expression`)* | LLM sedang memproses jawaban (`voice_stage`: `llm`/`start`) | Punya **`thinking`** ✅ | ✅ **via `voice_stage`** | Dengarkan `robot/voice_stage` (`stage="llm", state="start"`) $\rightarrow$ ubah wajah ke **`thinking`** |
| *(Belum dikirim sebagai `expression`)* | LLM gagal / kehabisan batas waktu (`voice_stage`: `error`/`llm`) | Punya **`timeout`** ✅ | ✅ **via `voice_stage`** | Dengarkan `robot/voice_stage` (`stage="error", state="llm"`) $\rightarrow$ ubah wajah ke **`timeout`** |

> **Catatan Tambahan untuk GUI v2 (`BroneGUI-Tauri`):**  
> Fitur **viseme mulut** (`brone/face/viseme`) sangat bagus untuk membuat mulut bergerak sinkron dengan suara, namun saat ini **LLM (`brone-talk-nuc` maupun `brone_talk`) hanya mengeluarkan output audio Piper TTS dan durasi detik (`duration`), belum memproduksi timestamp fonem/viseme**.  
> **Status 12 November 2026:** GUI v2 sudah punya fallback animasi mulut sintetis sebagai *worst case*, tetapi **nonaktif default** (`bicara.fallbackMulutAktif: false`). Saat fallback mulai, mulut mengikuti ekspresi aktif lebih dulu, lalu mengganti vokal `A/I/U/E/O`. Fallback berhenti saat `bicara selesai` atau saat jadwal viseme asli masuk. Ini bukan pengganti viseme sinkron; opsi viseme dinamis tetap butuh kesepakatan dengan tim LLM.

---

## 5. Rencana Tindak Lanjut & Pembagian Solusi untuk Tim Pengembang

Agar integrasi cepat tuntas dan QC bisa segera menjalankan **uji *multiprogramming* LLM + Expression GUI**, tersedia **2 opsi penyelarasan** untuk disepakati tim LLM & kedua pembuat GUI:

> **Status 12 November 2026 (GUI v2):** Opsi A butir 1 sudah diterapkan di `BroneGUI-Tauri`. Adapter subscribe `robot/expression` + `robot/voice_stage`, memetakan payload/emosi sesuai Tabel Bagian 4, dan tetap menerima topik lama `brone/face/*` untuk uji manual. Kode LLM tidak diubah.

### Opsi A (Paling Cepat & Aman: Tanpa Mengubah Kode Inti LLM)
Biarkan `brone-talk-nuc` tetap mengirim kontrak `robot/#` seperti sekarang, lalu tim GUI melakukan salah satu dari ini:
1. **Menyesuaikan parser/adapter di sisi masing-masing GUI (atau 1 *MQTT Bridge/Translator* Python bersama di Jetson)** agar subscribe ke `robot/expression` + `robot/voice_stage` dan memetakan payload serta emosi sesuai **Tabel Bagian 4**.
2. Keuntungan: Kode produksi `brone-talk` di NUC tidak tersentuh risiko bug, dan **kedua versi GUI bisa langsung diuji bersamaan dengan input yang 100% identik**.

### Opsi B (Menyamakan Kontrak Langsung di Pengirim & Penerima)
Sepakati 1 kontrak MQTT final antar tim (misalnya memakai envelope JSON standar + daftar ekspresi `idle, happy, happier, sad, cry, shock, thinking, timeout`) sehingga tidak perlu penerjemah di tengah:
* **Tim LLM:** Mengubah fungsi `Telemetry.expression()` (serta mengirim `thinking`/`timeout` dari siklus `app.py`/`brone_talk.py`).
* **Tim GUI v2 (`BroneGUI-Tauri`):** Menyesuaikan topik & format JSON di `src-tauri/src/lib.rs` dan `protocol.rs` agar cocok dengan kontrak bersama (termasuk mekanisme saat `speaking` tanpa mewajibkan jadwal viseme).

---

## 6. Checklist Kesiapan Sebelum Diserahkan ke Uji QC

Sebelum meminta QC mengukur penggunaan CPU, RAM, GPU, FPS, dan stabilitas sistem gabungan (**LLM di NUC + Expression GUI di Jetson**), pastikan 4 poin ini sudah lulus lebih dulu:

1. [ ] **Koneksi ke broker `mosquitto` Jetson (`192.168.100.2:1883`) terverifikasi lintas NUC–Jetson** (uji dari NUC: `nc -zv 192.168.100.2 1883` sukses dan `mosquitto_sub -h 192.168.100.2 -t '#' -v` menampilkan pesan masuk dari `brone-talk`; unit systemd GUI tidak memakai `Requires=mosquitto.service`).
2. [ ] **Layar wajah merespons saat LLM bekerja nyata** — ucapkan sapaan ke mikrofon BRONE:
   * Saat diam $\rightarrow$ wajah tampil **`idle`**.
   * Saat LLM memproses pertanyaan $\rightarrow$ wajah berubah ke **`thinking`**.
   * Saat speaker berbicara $\rightarrow$ animasi/ekspresi jawaban tampil (tidak tertolak log `rejected` / `Gagal parse JSON`).
   * Saat selesai bicara $\rightarrow$ wajah kembali ke ekspresi jawaban/standby **`idle`** secara bersih.
3. [ ] **Log error MQTT kosong / nol pesan tertolak** di terminal/journal backend GUI.
4. [ ] **Konfirmasi versi GUI yang akan diuji QC** (apakah kedua versi `brone-gui-new` dan `BroneGUI-Tauri` diuji bergantian untuk dibandingkan bebannya di Jetson, atau dipilih satu versi final).

---

## 7. Status Implementasi GUI v2 (Revisi 12 November 2026)

| Item | Status | Bukti |
|---|---|---|
| Topik `robot/expression` + `robot/voice_stage` | ✅ diterapkan | `src-tauri/src/connector/mqtt.rs` |
| Adapter payload & mapping emosi | ✅ diterapkan | `src-tauri/src/connector/protocol.rs` |
| `speaking` → `bicara mulai` | ✅ diterapkan | adapter `protocol.rs` |
| `thinking` / `timeout` dari `voice_stage` | ✅ diterapkan | adapter `protocol.rs` |
| Resubscribe setelah reconnect | ✅ diterapkan | subscribe pada `ConnAck` |
| `Requires=mosquitto.service` dihapus | ✅ diterapkan | `scripts/brone-gui.service`, `docs/DEPLOY.md` |
| Fallback mulut sintetis | ✅ kode ada, nonaktif default | `src/js/connector.js`, `bicara.fallbackMulutAktif: false` |
| Unit test adapter Rust | ✅ ditulis | `protocol.rs` (`cargo test` belum dijalankan di mesin ini) |
| Uji MQTT langsung LLM → GUI di robot | ❌ belum | langkah berikutnya |
| Verifikasi auth/ACL broker | ❌ belum | cek `/etc/mosquitto/conf.d/*.conf` |

Catatan: checklist Bagian 6 tetap berlaku sebagai syarat serah terima QC. Item sisi GUI sudah selesai; item jaringan dan uji langsung belum.
