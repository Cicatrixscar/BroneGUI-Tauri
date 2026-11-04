# BroneGUI-Tauri

Tampilan wajah 2D robot Brone, dibangun dengan Tauri.

## Struktur

```
brone-gui/
├── src/                  FRONTEND (HTML, CSS, JavaScript)  -> dikembangkan di laptop
├── src-tauri/            BACKEND (Rust, connector)         -> build dan uji di Linux
├── docs/                 kontrak pesan, keputusan, protokol benchmark
├── benchmark/            skrip pengukuran RAM, CPU, FPS    -> dijalankan di NUC
└── README.md
```

## Pembagian FE dan BE

| Bagian | Lokasi | Isi | Tempat kerja |
|---|---|---|---|
| FE | `src/` | Render wajah, state ekspresi, interpolasi, kedip, viseme | Laptop (browser) |
| BE | `src-tauri/` | Connector: terima pesan JSON dari modul LLM, validasi, kirim ke FE | VM atau NUC (Linux) |
| Kontrak | `docs/CONTRACT.md` | Format pesan yang disepakati FE dan BE | Dibaca keduanya |

Aturan sederhana: FE tidak tahu cara LLM bekerja. BE tidak tahu cara wajah digambar. Keduanya hanya bertemu lewat pesan di `docs/CONTRACT.md`.

## Setup (di VM atau NUC, Ubuntu yang sama)

```bash
# prasyarat Tauri: lihat https://tauri.app/start/prerequisites/
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# jika proyek belum dibuat dengan generator:
npm create tauri-app@latest .   # isi folder ini; jangan timpa src/ dan docs/

npm install
npm run tauri dev
```

## Catatan

- Folder `src-tauri/src/connector/` berisi kerangka. Belum dikompilasi sampai `Cargo.toml` dari generator sudah ditambah dependensi (`serde`, `serde_json`, dll.).
- `benchmark/` tidak ikut dibuild. Jalankan langsung di NUC.
