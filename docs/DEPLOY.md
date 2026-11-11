# Brone GUI — Deploy Guide

> **Repo:** `https://github.com/Cicatrixscar/BroneGUI-Tauri.git`  
> **Branch:** `main`  
> **Target Perangkat yang Didukung:**
> 1. **Nvidia Jetson Orin Nano** (ARM64 / `aarch64` — Unit Display Layar Wajah Robot)  
> 2. **Intel NUC** (x86_64 — Unit Komputasi / ROS2)

---

## 📑 Daftar Isi Cepat
- [🖥️ Legenda Terminal](#-legenda-terminal)
- [🚀 Bab Khusus: Panduan Deploy di Nvidia Jetson Orin Nano (ARM64)](#-bab-khusus-panduan-deploy-di-nvidia-jetson-orin-nano-arm64) *(Baru & Direkomendasikan untuk Layar Robot)*
- [Langkah Deploy Standar (Intel NUC / PC Linux x86_64)](#langkah-1--pastikan-kode-sudah-di-github)
  - [Langkah 1 — Pastikan Kode di GitHub](#langkah-1--pastikan-kode-sudah-di-github)
  - [Langkah 2 — SSH ke Perangkat](#langkah-2--ssh-ke-robot)
  - [Langkah 3 — Install Prasyarat (NUC)](#langkah-3--install-prasyarat-sekali-saja)
  - [Langkah 4 — Clone / Update Kode](#langkah-4--clone-atau-update-kode)
  - [Langkah 5 — Build Aplikasi](#langkah-5--build)
  - [Langkah 6 — Jalankan Aplikasi](#langkah-6--jalankan-aplikasi)
  - [Langkah 7 — Uji Fungsional MQTT](#langkah-7--uji-fungsional-test-mqtt)
  - [Langkah 8 — Autostart systemd](#langkah-8--autostart-opsional)
- [Kontrol Aplikasi (Shortcut & Mode Statis)](#kontrol-aplikasi)
- [Troubleshooting & Solusi Error](#troubleshooting)
- [Cheatsheet Referensi Cepat](#cheatsheet-referensi-cepat)

---

## 🖥️ Legenda Terminal

> `🪟 WINDOWS` — Jalankan di terminal laptop Windows kamu saat ini  
> `🤖 JETSON` — Jalankan di sesi SSH terminal Nvidia Jetson Orin Nano  
> `🤖 NUC` — Jalankan di sesi SSH terminal Intel NUC (jika deploy di NUC)

---

## Alur Deploy Singkat

```
🪟 WINDOWS                        🤖 ROBOT
─────────────────                 ─────────────────────────────────
git push (sudah ✅)   ──────►     git pull origin main
                                  ↓
                                  Install prasyarat (sekali saja)
                                  ↓
                                  cargo tauri build
                                  ↓
                                  Jalankan ./brone-gui
                                  ↓
                      ◄──────     Test MQTT: mosquitto_pub ...
```

---

## Langkah 1 — Pastikan Kode Sudah di GitHub

🪟 **WINDOWS** — Cek status push (seharusnya sudah beres):

```powershell
cd d:\Brone\brone-gui
git log --oneline -3
# Harus ada: 17c17d4 fix(config): restore bundle.active...
git status
# Harus: nothing to commit, working tree clean
```

✅ Sudah push — tidak perlu lakukan apapun di sini, langsung ke robot.

---

## Langkah 2 — SSH ke Robot

🪟 **WINDOWS** — Buka terminal SSH ke robot:

```powershell
ssh username@IP_ROBOT
# Contoh: ssh brone@192.168.1.50
```

> Semua langkah berikutnya dijalankan **di dalam sesi SSH** tersebut (di terminal robot).

---

## Langkah 3 — Install Prasyarat (Sekali Saja)

🤖 **ROBOT** — Jalankan langkah ini hanya jika robot belum pernah di-setup untuk Rust / Tauri sebelumnya.

### 3.1 — Install Paket Dasar Sistem (Wajib Sebelum Rust)
Paket-paket ini wajib ada agar script installer Rust (`curl`), kompilasi native C/C++ (`gcc`/`make`), dan SSL dapat bekerja:

```bash
sudo apt update
sudo apt install -y curl build-essential pkg-config libssl-dev git
```

---

### 3.2 — Install Rust Lengkap (rustup, rustc, cargo)

**A. Cek apakah Rust sudah terinstall:**
```bash
rustc --version
cargo --version
```
> Jika keduanya menampilkan versi (misal `rustc 1.8x.x`), kamu bisa langsung lanjut ke **3.3**.  
> Jika muncul pesan `command not found`, lanjutkan langkah install di bawah ini:

**B. Jalankan Installer Rust (Otomatis & Non-Interaktif):**
Gunakan parameter `-s -- -y` agar installer langsung memilih opsi default (1) secara otomatis tanpa menunggu input prompt keyboard:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

*(Catatan: Jika koneksi lambat dan ingin melihat proses interaktif, jalankan `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` lalu ketik `1` dan tekan Enter).*

**C. Muat Environment & PATH Cargo:**
Agar command `cargo` dan `rustc` langsung dapat dipanggil di terminal saat ini:

```bash
# Aktifkan di terminal saat ini:
source "$HOME/.cargo/env"

# Pastikan permanen masuk ke ~/.bashrc (agar tidak hilang saat login/SSH baru):
grep -qxF 'source "$HOME/.cargo/env"' ~/.bashrc || echo 'source "$HOME/.cargo/env"' >> ~/.bashrc
```

**D. Konfigurasi Toolchain & Target Linux x86_64:**
Pastikan toolchain stable aktif dan target kompilasi Linux x86_64 terpasang:

```bash
rustup default stable
rustup update stable
rustup target add x86_64-unknown-linux-gnu
```

**E. Verifikasi Instalasi Rust:**
```bash
rustc --version
cargo --version
rustup --version
```
*(Semua perintah di atas harus menghasilkan nomor versi tanpa error).*

---

### 3.3 — Install Library GUI (WebKit2GTK) untuk Tauri

Tauri membutuhkan runtime WebKitGTK dan pustaka grafis sistem Ubuntu:

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

---

### 3.4 — Install Tauri CLI v2

Tauri CLI digunakan untuk mem-bundle aplikasi (`cargo tauri build`):

```bash
# Cek apakah Tauri CLI sudah terpasang:
cargo tauri --version

# Jika belum terpasang, install versi 2:
cargo install tauri-cli --version "^2"
```

> [!NOTE]
> `cargo install tauri-cli` akan meng-compile dari source dan memakan waktu sekitar **5–10 menit** di Intel NUC. Biarkan proses berjalan hingga selesai.
>
> Verifikasi setelah selesai:
> ```bash
> cargo tauri --version
> # Output yang diharapkan: cargo-tauri 2.x.x
> ```

---

### 3.5 — Verifikasi Mosquitto Broker
Mosquitto diasumsikan sudah terpasang di robot. Cek statusnya:

```bash
sudo systemctl status mosquitto
# Harus menampilkan: Active: active (running)
```
*(Jika belum berjalan: `sudo systemctl enable mosquitto && sudo systemctl start mosquitto`)*

---

## Langkah 4 — Clone atau Update Kode

🤖 **ROBOT** — Pilih salah satu:

**Jika baru pertama kali (clone):**
```bash
cd ~
git clone https://github.com/Cicatrixscar/BroneGUI-Tauri.git brone_face_ascar
cd brone_face_ascar
```

**Jika sudah pernah clone sebelumnya (update):**
```bash
cd ~/brone_face_ascar
git pull origin main
git log --oneline -3
# Pastikan commit terbaru: 3b5e8df
```

---

## Langkah 5 — Build

🤖 **ROBOT** — Compile Rust + bundle frontend:

```bash
cd ~/brone_face_ascar
cargo tauri build
```

> [!NOTE]
> Build **pertama kali** butuh waktu **10–20 menit** karena compile semua crate dari awal.  
> Build selanjutnya (setelah update kode) jauh lebih cepat, ~2–5 menit.

Jika berhasil:
```
Finished release [optimized] target(s) in X minutes
    Built application at: src-tauri/target/release/brone-gui
```

Verifikasi binary ada:
```bash
ls -lh src-tauri/target/release/brone-gui
```

---

## Langkah 6 — Jalankan Aplikasi

🤖 **ROBOT** — Wajib pakai `GDK_BACKEND=x11` agar Tauri bekerja di Wayland:

```bash
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
```

Jika ingin langsung fullscreen dari awal:
```bash
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui &
# Lalu tekan F11 di keyboard/layar robot
```

> [!TIP]
> Jalankan di `tmux` atau `screen` agar sesi tetap hidup setelah SSH disconnect:
> ```bash
> tmux new -s brone
> GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
> # Ctrl+B lalu D untuk detach
> ```

---

## Langkah 7 — Uji Fungsional (Test MQTT)

> [!NOTE]
> Perintah `mosquitto_pub` bisa dijalankan dari **mana saja** — Windows atau Robot — asal terhubung ke MQTT broker robot.
> - Dari **robot langsung** pakai `127.0.0.1`
> - Dari **Windows** pakai IP robot, misal `192.168.1.50`

### Dari 🤖 ROBOT (paling mudah):

```bash
# Test idle
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"idle","durasi_ms":3000}'

# Test happy
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"happy","durasi_ms":3000}'

# Test happier (dengan blush)
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"happier","durasi_ms":3000}'

# Test happier_transisi (mata sipit)
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"happier_transisi","durasi_ms":3000}'

# Test sad
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"sad","durasi_ms":3000}'

# Test cry
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"cry","durasi_ms":5000}'

# Test shock
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"shock","durasi_ms":3000}'

# Test thinking
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"thinking","durasi_ms":5000}'

# Test timeout
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"timeout","durasi_ms":5000}'
```

### Dari 🪟 WINDOWS (jika mosquitto-clients terinstall / pakai WSL):

```powershell
# PowerShell — ganti IP_ROBOT dengan IP robot yang sebenarnya
mosquitto_pub -h IP_ROBOT -t "brone/face/ekspresi" -m "{\"tipe\":\"ekspresi\",\"emosi\":\"happy\",\"durasi_ms\":3000}"

# Atau pakai WSL:
wsl mosquitto_pub -h 192.168.1.50 -t "brone/face/ekspresi" -m '{"tipe":"ekspresi","emosi":"happy","durasi_ms":3000}'
```

---

## Langkah 8 — Autostart (Opsional)

🤖 **ROBOT** — Agar GUI otomatis muncul saat robot dinyalakan:

```bash
# Ganti YOUR_USERNAME dengan username kamu (cek dengan: whoami)
sudo nano /etc/systemd/system/brone-gui.service
```

Isi file:
```ini
[Unit]
Description=Brone Robot Face GUI
After=network.target graphical-session.target mosquitto.service
Requires=mosquitto.service

[Service]
Type=simple
User=YOUR_USERNAME
Environment=DISPLAY=:0
Environment=GDK_BACKEND=x11
Environment=BRONE_MQTT_HOST=127.0.0.1
Environment=BRONE_MQTT_PORT=1883
WorkingDirectory=/home/YOUR_USERNAME/brone_face_ascar
ExecStart=/home/YOUR_USERNAME/brone_face_ascar/src-tauri/target/release/brone-gui
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical-session.target
```

Aktifkan:
```bash
sudo systemctl daemon-reload
sudo systemctl enable brone-gui.service
sudo systemctl start brone-gui.service
sudo systemctl status brone-gui.service
```

---

## 🚀 Bab Khusus: Panduan Deploy di Nvidia Jetson Orin Nano (ARM64)

Bab ini khusus memandu instalasi dan deployment Brone-GUI pada **Nvidia Jetson Orin Nano** yang terhubung langsung ke monitor/layar wajah robot.

### 1. Karakteristik Teknis Jetson Orin Nano
| Item | Spesifikasi Jetson | Catatan untuk Brone-GUI |
|---|---|---|
| Arsitektur CPU | **ARM64** (`aarch64` / ARMv8.2) | Rust & Tauri meng-compile native ke binary ARM64 |
| GPU | Nvidia Ampere (1024 CUDA cores) | Perlu flag khusus driver jika WebKit blank |
| OS / JetPack | JetPack 5 (Ubuntu 20.04) atau JetPack 6 (Ubuntu 22.04) | Penyesuaian versi pustaka WebKitGTK |
| Kode Program | **100% Identik** | Tidak ada perubahan kode Rust, JS, maupun SVG |

---

### 2. Cek Versi Ubuntu di Terminal Jetson
Buka terminal Jetson (via SSH atau langsung di layar Jetson), lalu ketik:
```bash
uname -m          # Harus menampilkan: aarch64
lsb_release -a    # Perhatikan baris Release: 20.04 atau 22.04
```

---

### 3. Langkah Instalasi Prasyarat di Jetson (Sekali Saja)

> [!NOTE]
> Konfirmasi Robot Brone: Ubuntu **22.04.5** LTS (JetPack 6), `aarch64`, username `brone`.

#### Step 1 — Install semua dependency sistem sekaligus
```bash
sudo apt install -y curl build-essential pkg-config libssl-dev git \
  libxdo-dev libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev
```
*(Jika ada error 404 pada paket apt, jalankan `sudo apt update` terlebih dahulu).*

#### Step 2 — Install Rust (otomatis mendeteksi ARM64)
Gunakan installer rustup resmi — installer otomatis mengenali `aarch64-unknown-linux-gnu`:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

#### Step 3 — Aktifkan PATH Cargo
```bash
source "$HOME/.cargo/env"
grep -qxF 'source "$HOME/.cargo/env"' ~/.bashrc || echo 'source "$HOME/.cargo/env"' >> ~/.bashrc
```
*(Kedua perintah di atas tidak mengeluarkan output jika berhasil — itu normal).*

#### Step 4 — Verifikasi Rust
```bash
rustc --version
cargo --version
# Contoh output: rustc 1.8x.x (aarch64-unknown-linux-gnu)
```

#### Step 5 — Install Tauri CLI v2
```bash
cargo install tauri-cli --version "^2"
```
*(Proses compile sekitar 10–30 menit di Jetson Orin Nano — biarkan berjalan hingga selesai).*

Verifikasi:
```bash
cargo tauri --version
# Output: cargo-tauri 2.x.x
```

---

### 4. Clone / Pull Kode & Build di Jetson

```bash
# Jika pertama kali:
cd ~
git clone https://github.com/Cicatrixscar/BroneGUI-Tauri.git brone_face_ascar
cd brone_face_ascar

# Jika sudah pernah clone sebelumnya:
cd ~/brone_face_ascar
git pull origin main

# Build binary ARM64 release:
cargo tauri build
```
Hasil binary aplikasi akan berada di:
```text
~/brone_face_ascar/src-tauri/target/release/brone-gui
```
Verifikasi bahwa binary sudah bertipe ARM64:
```bash
file src-tauri/target/release/brone-gui
# Output: ELF 64-bit LSB pie executable, ARM aarch64 ...
```

---

### 5. Konfigurasi Alamat MQTT Antara Jetson dan NUC

Aplikasi Brone-GUI di Jetson mendengarkan topik ekspresi wajah (`brone/face/ekspresi`, `viseme`, `bicara`).

> [!NOTE]
> **Konfigurasi Robot Brone (Sudah Dikonfirmasi):**  
> Mosquitto broker berjalan **di Jetson sendiri** (`127.0.0.1:1883`).  
> Tidak perlu konfigurasi tambahan — aplikasi otomatis terhubung ke broker lokal.

* **Skenario 1 ✅ (Aktif di Robot Brone): Mosquitto Broker berjalan di dalam Jetson itu sendiri**  
  Tidak perlu konfigurasi apapun, aplikasi otomatis membaca dari `127.0.0.1:1883`.
* **Skenario 2: Mosquitto Broker berjalan di Intel NUC (atau PC lain)**  
  Misalkan IP Intel NUC adalah `192.168.1.50`, cukup set environment variable saat menjalankan:
  ```bash
  export BRONE_MQTT_HOST=192.168.1.50
  export BRONE_MQTT_PORT=1883
  ```

---

### 6. Menjalankan Aplikasi di Layar Jetson

Jalankan perintah ini di Jetson:
```bash
cd ~/brone_face_ascar
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
```

> [!IMPORTANT]
> **PENTING — Solusi Layar Hitam / Blank pada GPU Nvidia Jetson:**  
> Driver grafis Nvidia Tegra di Jetson terkadang memiliki ketidakcocokan dengan akselerasi DMA-BUF pada WebKitGTK yang menyebabkan window muncul tapi isinya hitam polos.  
> Jika ini terjadi, **cukup tambahkan flag `WEBKIT_DISABLE_DMABUF_RENDERER=1`**:
> ```bash
> WEBKIT_DISABLE_DMABUF_RENDERER=1 GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
> ```

Jika broker MQTT berada di Intel NUC:
```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 GDK_BACKEND=x11 DISPLAY=:0 BRONE_MQTT_HOST=192.168.1.50 ./src-tauri/target/release/brone-gui
```

---

### 7. Setup Autostart systemd Khusus Jetson

Agar aplikasi otomatis tampil di layar robot saat Jetson dinyalakan:

```bash
sudo nano /etc/systemd/system/brone-gui.service
```

Isi dengan template yang sudah disesuaikan untuk Jetson Orin Nano Robot Brone (username `brone`, broker MQTT di Jetson sendiri port `1883`):
```ini
[Unit]
Description=Brone Robot Face GUI (Jetson Orin Nano)
After=network.target graphical-session.target mosquitto.service
Requires=mosquitto.service

[Service]
Type=simple
User=brone
Environment=DISPLAY=:0
Environment=GDK_BACKEND=x11
Environment=WEBKIT_DISABLE_DMABUF_RENDERER=1
Environment=BRONE_MQTT_HOST=127.0.0.1
Environment=BRONE_MQTT_PORT=1883
WorkingDirectory=/home/brone/brone_face_ascar
ExecStart=/home/brone/brone_face_ascar/src-tauri/target/release/brone-gui
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical-session.target
```
*(Jika broker MQTT dipindah ke NUC di masa depan, ubah `BRONE_MQTT_HOST` ke IP NUC dan hapus baris `Requires=mosquitto.service`).*

Aktifkan service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable brone-gui.service
sudo systemctl start brone-gui.service
sudo systemctl status brone-gui.service
```

---

### 8. Troubleshooting Khusus Jetson Orin Nano

#### ❌ Window muncul tapi layar hitam / blank putih
**Penyebab:** Driver Nvidia Jetson mengunci hardware compositing WebKit.  
**Solusi:** Jalankan dengan menonaktifkan DMA-BUF:
```bash
export WEBKIT_DISABLE_DMABUF_RENDERER=1
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
```
Jika masih blank, tambahkan juga: `export WEBKIT_DISABLE_COMPOSITING_MODE=1`.

#### ❌ `cargo build` terasa sangat lambat / memori habis saat compile
**Penyebab:** Jetson Orin Nano (khususnya varian RAM 4GB atau 8GB) kehabisan RAM fisik saat linking crate besar.  
**Solusi:** Buat file swap sementara atau batasi paralelisme compiler:
```bash
# Batasi 2 thread kompilasi agar RAM tetap lega:
cargo tauri build -- -j 2
```

#### ❌ Gagal koneksi MQTT ke Intel NUC
**Penyebab:** Firewall di NUC memblokir port 1883 atau Mosquitto di NUC belum mengizinkan koneksi dari luar localhost.  
**Solusi:** Di NUC, pastikan `/etc/mosquitto/conf.d/default.conf` berisi:
```text
listener 1883 0.0.0.0
allow_anonymous true
```
Lalu restart Mosquitto di NUC: `sudo systemctl restart mosquitto`.

---

## Kontrol Aplikasi

| Tombol | Fungsi |
|---|---|
| **F11** | Toggle layar penuh ↔ jendela |
| **F2** | Toggle mode Dinamis ↔ Statis |
| **F3** | Toggle panel kontrol |
| **Escape** / **Ctrl+Q** | Keluar aplikasi |
| Mouse ke pojok atas | Tampilkan tombol ⛶ dan ✕ |

**Mode Statis — Panel Keyboard:**

- **Ekspresi (1–9):** `1` idle · `2` thinking · `3` sad · `4` cry · `5` shock · `6` happy · `7` happier · `8` timeout · `9` happier_transisi
- **Viseme Mulut:** `A`, `I`, `U`, `E`, `O`, `R` (REST/katup bibir), `D` (DIAM)

---

## Troubleshooting

### ❌ `cargo: command not found` atau `rustc: command not found`
Penyebab: PATH Cargo belum termuat di sesi terminal saat ini.
```bash
# Muat environment Cargo:
source "$HOME/.cargo/env"

# Cek apakah binary benar-benar ada di:
ls -l "$HOME/.cargo/bin/cargo"

# Jika file tidak ada, ulangi instalasi Rust:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

---

### ❌ `error: linker 'cc' not found` saat `cargo build`
Penyebab: Compiler C (`gcc`) belum terpasang di sistem Ubuntu robot.
```bash
sudo apt update
sudo apt install -y build-essential
```

---

### ❌ Permission denied di folder `~/.cargo` atau `~/.rustup`
Penyebab: Pernah menjalankan `sudo cargo ...` sehingga ownership file berubah menjadi milik `root`.
```bash
sudo chown -R $USER:$USER ~/.cargo ~/.rustup
```

---

### ❌ Build error: `could not find system library 'webkit2gtk-4.1'`
Penyebab: Library header WebKitGTK belum terpasang.
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev
```

---

### ❌ Aplikasi tidak muncul di layar robot (layar hitam / no display)
```bash
# Pastikan DISPLAY benar
echo $DISPLAY   # Harus ada isinya, misal :0
# Jalankan dengan env lengkap:
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
```

---

### ❌ Ekspresi tidak berubah setelah mosquitto_pub
```bash
# Cek broker jalan
sudo systemctl status mosquitto

# Cek log aplikasi (di terminal yang menjalankan brone-gui, cari baris MQTT)
# Atau via journalctl jika pakai systemd:
sudo journalctl -u brone-gui -f
```

---

### ❌ Layar terkunci, tidak bisa keluar
```bash
# Dari sesi SSH lain:
pkill brone-gui
# atau
sudo systemctl stop brone-gui
```

---

## Cheatsheet Referensi Cepat

```bash
# === UPDATE & BUILD (🤖 ROBOT) ===
cd ~/brone_face_ascar
git pull origin main
cargo tauri build

# === JALANKAN (🤖 ROBOT) ===
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui

# === TEST MQTT (🤖 ROBOT) ===
mosquitto_pub -h 127.0.0.1 -t "brone/face/ekspresi" \
  -m '{"tipe":"ekspresi","emosi":"happy","durasi_ms":3000}'

# === MONITOR MQTT (🤖 ROBOT) ===
mosquitto_sub -h 127.0.0.1 -t "brone/face/#" -v

# === LOG APLIKASI (🤖 ROBOT) ===
sudo journalctl -u brone-gui -f
```

### Daftar Ekspresi Valid

| English (canonical) | Indonesia (alias) |
|---|---|
| `idle` | `netral` |
| `happy` | `senang` |
| `happier` | `sangat_senang` |
| `happier_transisi` | `sangat_senang_transisi` |
| `sad` | `sedih` |
| `cry` | `menangis` |
| `shock` | `terkejut` |
| `thinking` | `berpikir` |
| `timeout` | *(tidak ada alias)* |
