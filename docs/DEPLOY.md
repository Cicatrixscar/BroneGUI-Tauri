# Brone GUI — Deploy Guide (Robot Intel NUC)

> **Repo:** `https://github.com/Cicatrixscar/BroneGUI-Tauri.git`  
> **Branch:** `main` · **Commit terkini:** `17c17d4`  
> **Target:** Intel NUC · Ubuntu 22.04.4 LTS · x86_64 · Layar 1024×600

---

## 🖥️ Legenda Terminal

> `🪟 WINDOWS` — Jalankan di terminal Windows kamu sekarang (PowerShell / CMD)  
> `🤖 ROBOT` — Jalankan di terminal robot (SSH ke robot)

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

🤖 **ROBOT** — Hanya jika belum pernah dilakukan sebelumnya:

```bash
# Cek apakah Rust sudah ada
rustc --version    # Jika error "command not found" → install Rust
cargo --version

# Jika Rust belum ada, install:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

```bash
# Cek apakah Tauri CLI sudah ada
cargo tauri --version    # Jika error → install Tauri CLI

# Jika belum ada:
cargo install tauri-cli --version "^2"
```

```bash
# Install sistem dependencies (diperlukan untuk build WebKit/GTK)
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

> [!NOTE]
> Mosquitto diasumsikan **sudah terinstall dan berjalan** di robot. Verifikasi cepat:
> ```bash
> sudo systemctl status mosquitto
> # Harus: Active: active (running)
> ```

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
# Pastikan commit terbaru: 17c17d4
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

## Kontrol Aplikasi

| Tombol | Fungsi |
|---|---|
| **F11** | Toggle layar penuh ↔ jendela |
| **F2** | Toggle mode Dinamis ↔ Statis |
| **F3** | Toggle panel kontrol |
| **Escape** / **Ctrl+Q** | Keluar aplikasi |
| Mouse ke pojok atas | Tampilkan tombol ⛶ dan ✕ |

**Mode Statis — Panel Keyboard:**

| `1` idle · `2` thinking · `3` sad · `4` cry · `5` shock |
|---|
| `6` happy · `7` happier · `8` timeout · `9` happier_transisi |

---

## Troubleshooting

### ❌ Aplikasi tidak muncul di layar robot
```bash
# Pastikan DISPLAY benar
echo $DISPLAY   # Harus ada isinya, misal :0
# Jalankan dengan env lengkap:
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
```

### ❌ Ekspresi tidak berubah setelah mosquitto_pub
```bash
# Cek broker jalan
sudo systemctl status mosquitto

# Cek log aplikasi (di terminal yang menjalankan brone-gui, cari baris MQTT)
# Atau via journalctl jika pakai systemd:
sudo journalctl -u brone-gui -f
```

### ❌ Build error: `could not find webkit2gtk-4.1`
```bash
sudo apt install -y libwebkit2gtk-4.1-dev
```

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
