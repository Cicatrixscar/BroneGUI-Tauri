# BroneGUI-Tauri

Tampilan wajah 2D robot Brone. Dibangun dengan **Tauri v2** (Rust backend + vanilla JS/SVG frontend).

Aplikasi menerima perintah ekspresi dan viseme dari LLM melalui **MQTT**, lalu menampilkannya sebagai animasi wajah SVG di layar robot.

---

## Daftar Isi

- [Arsitektur](#arsitektur)
- [Struktur Proyek](#struktur-proyek)
- [Frontend — Breakdown File](#frontend--breakdown-file)
- [Backend (Rust) — Breakdown File](#backend-rust--breakdown-file)
- [Konfigurasi](#konfigurasi)
- [Ekspresi & Aset SVG](#ekspresi--aset-svg)
- [Protokol MQTT](#protokol-mqtt)
- [Mode Operasi](#mode-operasi)
- [Kontrol Aplikasi](#kontrol-aplikasi)
- [Testing](#testing)
- [Deploy ke Robot](#deploy-ke-robot)

---

## Arsitektur

```
LLM / ROS2
    │
    │  MQTT publish
    ▼
Mosquitto Broker (127.0.0.1:1883)
    │
    │  subscribe: brone/face/ekspresi
    │             brone/face/viseme
    │             brone/face/bicara
    ▼
┌─────────────────── Tauri App ───────────────────────┐
│                                                     │
│  BACKEND (Rust)                                     │
│  ├── mqtt.rs       — terima & filter pesan MQTT     │
│  ├── protocol.rs   — validasi format JSON           │
│  └── auth.rs       — IPC commands (exit, fullscreen)│
│          │                                          │
│          │  Tauri Event IPC (brone://ekspresi, dll) │
│          ▼                                          │
│  FRONTEND (JS + SVG)                                │
│  ├── connector.js  — terima event, teruskan ke state│
│  ├── state.js      — state wajah terpusat           │
│  ├── renderer.js   — render + animasi SVG           │
│  ├── blink.js      — kedip otomatis                 │
│  ├── mode.js       — mode dinamis / statis          │
│  ├── panel.js      — panel kontrol & window control │
│  └── main.js       — titik masuk, inisialisasi      │
│                                                     │
└─────────────────────────────────────────────────────┘
         │
         ▼
   Layar Robot 1024×600
```

**Prinsip desain:** FE tidak tahu cara LLM bekerja. BE tidak tahu cara wajah digambar. Keduanya hanya bertemu lewat pesan sesuai `docs/CONTRACT.md`.

---

## Struktur Proyek

```
brone-gui/
│
├── src/                          # FRONTEND — dikembangkan di laptop (browser)
│   ├── index.html                # Halaman utama, struktur SVG wajah
│   ├── css/
│   │   └── style.css             # Styling SVG, panel kontrol, window controls
│   ├── js/
│   │   ├── main.js               # Entry point — inisialisasi semua modul
│   │   ├── state.js              # State terpusat (emosi, viseme, params)
│   │   ├── renderer.js           # Render & animasi SVG (anime.js)
│   │   ├── blink.js              # Controller kedip otomatis
│   │   ├── connector.js          # Jembatan MQTT event → state
│   │   ├── mode.js               # Manajemen mode dinamis/statis
│   │   ├── panel.js              # Panel kontrol manual + window controls
│   │   ├── interpolator.js       # Utilitas lerp & easing (cadangan)
│   │   ├── viseme.js             # Helper pemilihan viseme dari jadwal
│   │   └── lib/
│   │       └── anime.min.js      # Library animasi anime.js (lokal)
│   ├── assets/                   # Aset SVG yang dipakai saat runtime
│   │   ├── MATA.svg              # Mata normal (idle, happy, shock)
│   │   ├── HAPPIER EYE.svg       # Mata happier (dengan blush)
│   │   ├── MATA HAPPIER TRANSITION.svg      # Mata kiri happier_transisi
│   │   ├── MATA HAPPIER TRANSITION KANAN.svg # Mata kanan happier_transisi
│   │   ├── TIMEOUT EYE LEFT.svg  # Mata spiral kiri (timeout)
│   │   ├── TIMEOUT EYE RIGHT.svg # Mata spiral kanan (timeout)
│   │   ├── SAD EYE LEFT/RIGHT.svg
│   │   ├── CRY EYE LEFT/RIGHT.svg
│   │   ├── LOAD EYE.svg          # Mata kiri thinking (berputar / loading)
│   │   ├── HAPPIER.svg           # Mulut happy/happier/happier_transisi
│   │   ├── IDLE.svg              # Mulut idle/netral
│   │   ├── SAD MOUTH.svg
│   │   ├── CRY MOUTH.svg
│   │   ├── SHOCK.svg
│   │   ├── LOAD MOUTH.svg        # Mulut thinking
│   │   ├── TIMEOUT MOUTH.svg     # Mulut timeout (bergelombang)
│   │   ├── BLUSH.svg             # Pipi merah muda (happier)
│   │   ├── DRIPPING TEARS.svg    # Air mata kiri (cry)
│   │   ├── DRIPPING TEARS RIGHT.svg
│   │   ├── TANDA SERU.svg        # Efek "!" (shock)
│   │   ├── TANDA TANYA.svg       # Efek "?" (thinking)
│   │   ├── BRONE_FACE_BACKSIDE.svg # Latar belakang wajah
│   │   └── viseme/               # Aset mulut viseme dinamis (A, I, U, E, O, REST)
│   │       ├── A.svg, E.svg, I.svg, O.svg, U.svg, REST.svg
│   │       └── (DIAM = null, kembali ke bentuk mulut ekspresi)
│   └── config/                   # Konfigurasi yang di-bundle bersama app
│       ├── config.json           # Koordinat aset, warna, blink interval
│       └── keymap.json           # Mapping keyboard ke ekspresi/viseme
│
├── src-tauri/                    # BACKEND — dikompilasi di Linux (robot)
│   ├── Cargo.toml                # Dependensi Rust
│   ├── build.rs                  # Build script Tauri
│   ├── tauri.conf.json           # Konfigurasi window, bundle, keamanan
│   ├── capabilities/
│   │   └── default.json          # Izin Tauri IPC yang diizinkan
│   └── src/
│       ├── main.rs               # Binary entry point (delegasi ke lib.rs)
│       ├── lib.rs                # Setup Tauri builder, inisialisasi MQTT
│       ├── commands/
│       │   ├── mod.rs            # Deklarasi modul commands
│       │   └── auth.rs           # IPC commands: exit_app, toggle_fullscreen, is_fullscreen
│       └── connector/
│           ├── mod.rs            # Deklarasi modul connector
│           ├── mqtt.rs           # MQTT client (subscribe + event loop)
│           └── protocol.rs       # Struct Pesan, validasi, daftar ekspresi valid
│
├── atomic-assets/                # Aset SVG sumber desain (tidak di-bundle ke app)
│   ├── expression-and-base-atomic/   # Komponen ekspresi individual
│   └── viseme-atomic/                # Komponen viseme individual
│
├── config/                       # Konfigurasi sumber (di-copy ke src/config/)
│   ├── config.json
│   └── keymap.json
│
├── docs/                         # Dokumentasi kontrak dan keputusan
│   └── CONTRACT.md               # Format pesan MQTT yang disepakati FE & BE
│
├── tests/
│   └── fe/                       # Unit test frontend (Node.js --test)
│       ├── blink.test.js
│       ├── connector.test.js
│       ├── interpolator.test.js
│       ├── mode.test.js
│       ├── transition.test.js
│       └── viseme.test.js
│
├── benchmark/                    # Skrip pengukuran performa (dijalankan di NUC)
├── expression/                   # File SVG wajah lengkap per ekspresi (referensi desain)
├── viseme/                       # Referensi visual viseme lengkap
└── README.md
```

---

## Frontend — Breakdown File

### `src/index.html`
Halaman utama. Mendefinisikan struktur SVG wajah dengan layer-layer:
- `#layer-backside` — latar belakang wajah
- `#layer-blush` — pipi merah muda (blush)
- `#eye-l-wrap` / `#eye-r-wrap` — wrapper mata kiri/kanan (target animasi kedip)
- `#eye-l` / `#eye-r` — `<image>` SVG aset mata
- `#tear-l-wrap` / `#tear-r-wrap` — wrapper air mata
- `#layer-mouth` — wrapper mulut (target animasi)
- `#mouth` — `<image>` SVG aset mulut
- `#layer-effects` — overlay efek (tanda seru/tanya)
- `#window-controls` — tombol fullscreen + tutup (pojok kanan atas)

---

### `src/js/main.js`
**Entry point aplikasi.** Dijalankan saat `DOMContentLoaded`.

| Fungsi / Blok | Deskripsi |
|---|---|
| `DEFAULT_CONFIG` | Konfigurasi fallback jika `config.json` gagal dimuat. Berisi koordinat semua ekspresi, aset, viseme positions, blink interval. |
| `DEFAULT_KEYMAP` | Keymap fallback: F2 mode, F3 panel, 1–9 ekspresi, q–g viseme. |
| `fetchJsonFirstAvailable(paths, fallback, name)` | Coba fetch JSON dari beberapa path berurutan. Jika semua gagal, pakai fallback. |
| `initApp()` | Muat `config.json` + `config.local.json` (opsional override) + `keymap.json`. Inisialisasi semua kelas: `FaceState`, `BlinkController`, `Renderer`, `ModeManager`, `ControlPanel`, `initConnector`. |
| Event listeners keyboard | F11 → `toggleFullscreen()`, Escape/Ctrl+Q → `closeApplication()`. |
| Auto-hide window controls | `mousemove` di `y < 80px` → tampilkan tombol selama 2500ms lalu sembunyikan. `touchstart` di area atas juga memicu. |

---

### `src/js/state.js` — `class FaceState`
**State terpusat wajah.** Satu-satunya sumber kebenaran untuk kondisi wajah saat ini.

| Method | Deskripsi |
|---|---|
| `constructor(config)` | Inisialisasi state: `emosi='idle'`, `intensitas=1.0`, `viseme='DIAM'`, `params` (eyeOpenness, eyeSquint, mouthOpenness, mouthCurvature). |
| `addListener(fn)` | Daftarkan callback yang dipanggil setiap kali state berubah. |
| `removeListener(fn)` | Hapus listener yang terdaftar. |
| `notifyChange()` | Panggil semua listener dan `onStateChange` callback. |
| `setBlinkFactor(factor)` | Update `params.eyeOpenness` (dipakai oleh `BlinkController`). |
| `setEmotion(emosi, intensitas)` | Ganti emosi aktif → trigger `notifyChange()`. |
| `setViseme(viseme)` | Ganti viseme aktif → trigger `notifyChange()`. |
| `resetToIdle()` | Reset semua ke kondisi idle/netral. |

---

### `src/js/renderer.js` — `class Renderer`
**Merender dan menganimasikan SVG wajah.** Mendengarkan perubahan `FaceState` dan memperbarui DOM SVG.

| Method | Deskripsi |
|---|---|
| `constructor(svgElement, state, blinkController, config)` | Ambil semua referensi elemen DOM SVG. Inisialisasi backside, animasi anime.js. Pasang listener ke state. |
| `initBackside()` | Render aset latar belakang wajah (`BRONE_FACE_BACKSIDE.svg`) ke `#layer-backside`. |
| `initAnimeAnimations()` | Siapkan animasi loop: efek melayang `#layer-effects` (translateY ±6px, 900ms) dan aliran air mata `tearLWrap`/`tearRWrap` (translateY 0→75px, 700ms). Keduanya `autoplay: false`. |
| `start()` | Mulai loop render via `requestAnimationFrame`. |
| `render(timestamp)` | Loop RAF utama: sinkronisasi state, update kedip, rotasi mata spiral timeout. |
| `triggerBlinkAnimation()` | Jalankan animasi kedip via anime.js: `scaleY` 1.0 → 0.04 → 1.0 dalam `durationMs`. |
| `applyState(force)` | Deteksi perubahan emosi/viseme. Jika emosi berubah → `transitionToEmotion()`. Jika hanya viseme berubah → `updateMouth()`. |
| `transitionToEmotion(targetEmotion)` | **Animasi pergantian ekspresi 3 fase:** (1) mata menutup + mulut merapat (175ms), (2) di titik tengah: swap aset mata & mulut ke ekspresi baru, (3) mata membuka + mulut membuka (175ms). Total ±350ms. |
| `setMouthToFlat()` | Pasang aset mulut paling datar (`P,B,M.svg`) selama titik tengah transisi. |
| `updateEyes(emosi)` | Ganti `href`, `x`, `y`, `width`, `height` pada `#eye-l` dan `#eye-r` sesuai ekspresi. |
| `clearEmotionOverlays()` | Sembunyikan blush, air mata (pause animasi), efek simbol. Hapus transform rotasi timeout dari mata. |
| `updateEmotionOverlays(emosi)` | Tampilkan overlay sesuai ekspresi: blush (happier), air mata + animasi aliran (cry), simbol melayang (shock/thinking). |
| `updateEmotion(emosi)` | Shortcut: `updateEyes()` + `updateEmotionOverlays()`. |
| `updateMouth(emosi, viseme)` | Jika viseme aktif (bukan DIAM): pakai aset viseme. Jika DIAM: pakai mulut ekspresi. Animasi fade-in kecil (scale 0.94→1.0). |

**Logika khusus timeout:** Mata spiral dirotasi berkelanjutan via `transform="rotate(angle cx cy)"` di loop RAF. Mata kiri berputar searah jarum jam, mata kanan berlawanan. Kedip acak dinonaktifkan selama mode timeout.

---

### `src/js/blink.js` — `class BlinkController`
**Controller kedip otomatis** dengan interval acak (meniru kedip alami).

| Method | Deskripsi |
|---|---|
| `constructor(config)` | Set interval min/max (default 3000–6000ms), durasi kedip (default 350ms). |
| `randomDelay()` | Hasilkan delay acak antara `minIntervalMs` dan `maxIntervalMs`. |
| `update(now)` | Dipanggil tiap frame RAF. Kembalikan `eyeOpenness factor` (0.0–1.0). Kurva: `1 - sin(progress * π)` untuk buka→tutup→buka yang mulus. |

Kedip dinonaktifkan otomatis selama transisi ekspresi dan saat ekspresi `timeout` aktif.

---

### `src/js/connector.js` — `initConnector(state, modeManager)`
**Jembatan antara event MQTT (dari Rust) dan `FaceState`.** Mendaftarkan listener ke Tauri Event API.

| Fungsi / Blok | Deskripsi |
|---|---|
| `EMOTION_ALIASES` | Map alias Indonesia ke nama canonical English: `senang`→`happy`, `sangat_senang`→`happier`, dll. |
| `batalkanVisemeTimers()` | Batalkan semua `setTimeout` jadwal viseme yang sedang aktif. |
| `jalankanJadwalViseme(jadwal)` | Jadwalkan setiap item viseme via `setTimeout` berdasarkan `t` (detik). Pasang watchdog 500ms setelah viseme terakhir untuk reset ke DIAM. |
| `handlePayload(rawPayload)` | Handler utama. Parse JSON jika perlu. **Deduplikasi:** pesan identik dalam <30ms diabaikan. Filter mode statis via `modeManager`. Routing: `ekspresi` → `state.setEmotion()` + timer auto-reset ke idle, `viseme` → `jalankanJadwalViseme()`, `bicara/selesai` → reset viseme ke DIAM. |
| Tauri Event Listener | Coba daftarkan listener ke `window.__TAURI__?.event?.listen` atau `window.__TAURI_INTERNALS__?.listen`. Listen ke beberapa format event name (`brone://ekspresi`, `brone/ekspresi`, `brone:ekspresi`, `brone-message`) untuk kompatibilitas. |
| SSE Fallback | Jika tidak ada Tauri (mode dev browser), buka `EventSource('/events')` sebagai fallback. |
| `window.sendBroneMessage` | Helper global untuk testing manual dari konsol browser. |

---

### `src/js/mode.js` — `class ModeManager`
**Manajemen mode operasi:** dinamis (terima MQTT) vs statis (kontrol manual keyboard).

| Method | Deskripsi |
|---|---|
| `constructor(config, keymap, state, panel)` | Set mode default dari config. Pasang event listener `keydown` global. |
| `isStatic()` / `isDynamic()` | Cek mode saat ini. |
| `isLockedOut()` / `getLockoutRemainingSeconds()` | Selalu `false`/`0` — fitur lockout dinonaktifkan. |
| `verifyPassword()` | Selalu `{success: true}` — autentikasi dinonaktifkan. |
| `switchMode()` | Toggle dinamis↔statis. Jika kembali ke dinamis: `state.resetToIdle()`. Panggil `onModeChange` callback. |
| `handleIncomingMessage(message)` | Di mode statis: buang pesan (return `false`). Di mode dinamis: izinkan (return `true`). |
| `handleKeyDown(event)` | F2: toggle mode. Di mode statis: F3 toggle panel, 1–9 set ekspresi, q–g set viseme. Di mode dinamis: semua tombol kecuali F2 diabaikan. |
| `destroy()` | Hapus event listener `keydown` (cleanup). |

---

### `src/js/panel.js`
**Panel kontrol visual (mode statis) dan window controls.**

| Ekspor | Deskripsi |
|---|---|
| `closeApplication()` | Panggil Tauri IPC `exit_app` via triple-fallback (`__TAURI__.core.invoke` → `__TAURI__.invoke` → `__TAURI_INTERNALS__.invoke`). Fallback: `window.close()`. |
| `toggleFullscreen()` | Panggil Tauri IPC `toggle_fullscreen` → update ikon tombol (⛶/⊡). Fallback: Web Fullscreen API (`document.documentElement.requestFullscreen()`). |

**`class ControlPanel`**

| Method | Deskripsi |
|---|---|
| `constructor(state, modeManager, keymap)` | Buat panel DOM, daftarkan listener state untuk update indikator aktif. |
| `initDOM()` | Buat elemen `#control-panel` secara programatik: header (badge MODE STATIS, shortcut F2/F3/F11/Esc), grid tombol ekspresi (1–9), grid tombol viseme (Q–G). Pasang click handler semua tombol. |
| `setMode(mode)` | Tampilkan panel jika mode statis, sembunyikan jika dinamis. |
| `togglePanelVisibility()` | Toggle visibilitas panel (hanya di mode statis). |
| `updateActiveIndicators()` | Tambahkan class `active` pada tombol ekspresi/viseme yang sedang aktif sesuai `state`. |

---

### `src/js/interpolator.js`
**Utilitas interpolasi dan easing** (saat ini dipakai sebagai cadangan, animasi utama via anime.js).

| Ekspor | Deskripsi |
|---|---|
| `lerp(a, b, t)` | Linear interpolation: `a + (b - a) * t`. |
| `EASING` | Map fungsi easing: `linear`, `easeInOutQuad`, `easeOutCubic`. |
| `class Interpolator` | Objek transisi: `start(current, target, duration)` → `update(now)` kembalikan nilai terinterpolasi. Mendukung multi-key object sekaligus. |

---

### `src/js/viseme.js`
**Helper pemilihan viseme dari jadwal.**

| Ekspor | Deskripsi |
|---|---|
| `visemeAt(jadwal, t)` | Dari array `[{t, v}]` yang sudah terurut, kembalikan viseme yang aktif pada waktu `t` detik. Default: `'DIAM'`. |

---

### `src/js/lib/anime.min.js`
Library animasi **anime.js** (versi minified, disimpan lokal). Dipakai oleh `renderer.js` untuk animasi kedip, transisi ekspresi, air mata, blush, dan efek melayang. Fallback CSS transform dipakai jika anime.js tidak tersedia.

---

## Backend (Rust) — Breakdown File

### `src-tauri/src/main.rs`
Binary entry point. Hanya berisi satu baris: delegasi ke `brone_gui_lib::run()`. Atribut `windows_subsystem = "windows"` mencegah console window muncul di build release Windows.

---

### `src-tauri/src/lib.rs`
**Setup utama Tauri Builder.**

| Blok | Deskripsi |
|---|---|
| Setup `env_logger` | Log ke stderr dengan level default `info`. |
| `MqttConfig` | Ambil `BRONE_MQTT_HOST` dan `BRONE_MQTT_PORT` dari environment variable (fallback: `127.0.0.1:1883`). Subscribe ke 3 topic: `brone/face/ekspresi`, `brone/face/viseme`, `brone/face/bicara`. |
| `tauri::async_runtime::spawn` | Jalankan `start_mqtt_client()` sebagai async background task Tokio (tidak memblokir UI). |
| `invoke_handler` | Daftarkan 4 IPC command ke frontend: `verify_mode_password`, `exit_app`, `toggle_fullscreen`, `is_fullscreen`. |

---

### `src-tauri/src/connector/mqtt.rs`
**MQTT client berbasis `rumqttc`.**

| Fungsi / Struct | Deskripsi |
|---|---|
| `struct MqttConfig` | Konfigurasi koneksi: `host`, `port`, `client_id`, `topics` (vec). |
| `impl Default for MqttConfig` | Nilai default: `127.0.0.1:1883`, client ID `brone_gui_display`, 3 topic. |
| `start_mqtt_client(app_handle, config)` | **Async loop utama MQTT:** (1) buat koneksi dengan `keep_alive=15s` dan `clean_session=true`, (2) subscribe semua topic dari config, (3) loop `eventloop.poll()` — saat menerima `Publish`: parse UTF-8 → parse JSON → validasi via `validasi_pesan()` → emit Tauri event (`brone://ekspresi` / `brone://viseme` / `brone://bicara`). Error koneksi: log warning + sleep 2s (reconnect otomatis). |

**Penting:** Tidak ada `client.publish()` di seluruh file — aplikasi hanya **subscribe**, tidak pernah publish ke MQTT.

---

### `src-tauri/src/connector/protocol.rs`
**Definisi tipe data dan validasi pesan sesuai `docs/CONTRACT.md`.**

| Item | Deskripsi |
|---|---|
| `VALID_EMOSI` | Daftar nama ekspresi yang diizinkan: 9 nama English canonical + 7 alias Indonesia. |
| `VALID_VISEME` | 15 kode viseme yang diizinkan: `P_B_M`, `TH`, `N_L`, `T_D`, `F_V`, `K`, `C_J_SY`, `S_Z`, `R`, `A`, `E`, `I_G`, `O`, `U`, `DIAM`. |
| `struct VisemeItem` | `{ t: f32, v: String }` — satu item jadwal viseme. |
| `enum Pesan` | Tagged union dengan `#[serde(tag = "tipe")]`: `Ekspresi { id, emosi, intensitas, durasi_ms }`, `Viseme { id, jadwal }`, `Bicara { status }`. |
| `fn default_intensitas()` | Kembalikan `1.0` (nilai default field `intensitas`). |
| `fn validasi_pesan(p)` | Validasi: `Ekspresi` → intensitas 0.0–1.0, emosi ada di `VALID_EMOSI`. `Viseme` → jadwal tidak kosong, semua kode viseme valid. `Bicara` → status hanya `"mulai"` atau `"selesai"`. |

---

### `src-tauri/src/commands/auth.rs`
**Tauri IPC commands yang dapat dipanggil dari frontend.**

| Command | Signature | Deskripsi |
|---|---|---|
| `verify_mode_password` | `(_password: Option<String>) -> bool` | Selalu return `true` — autentikasi dinonaktifkan. |
| `exit_app` | `(app_handle: AppHandle)` | Keluar dari proses aplikasi (`app_handle.exit(0)`). |
| `toggle_fullscreen` | `(window: Window) -> Result<bool, String>` | Toggle fullscreen window. Return state fullscreen yang baru. |
| `is_fullscreen` | `(window: Window) -> Result<bool, String>` | Kembalikan apakah window sedang fullscreen. |

---

### `src-tauri/Cargo.toml`
Dependensi Rust proyek:

| Crate | Versi | Fungsi |
|---|---|---|
| `tauri` | `^2` | Framework aplikasi desktop Tauri v2 |
| `serde` | `^1` + `derive` | Serialisasi/deserialisasi struct Rust ↔ JSON |
| `serde_json` | `^1` | Parse dan encode JSON |
| `tokio` | `^1` + `full` | Async runtime (dipakai untuk MQTT loop) |
| `rumqttc` | `0.24` | MQTT client async berbasis Tokio |
| `log` | `^0.4` | Logging abstraction layer |
| `env_logger` | `^0.11` | Backend logging ke stderr dengan filter level |

---

### `src-tauri/tauri.conf.json`
**Konfigurasi runtime Tauri.**

| Field | Nilai | Keterangan |
|---|---|---|
| `productName` | `brone-gui` | Nama binary hasil build |
| `identifier` | `com.brone.gui` | App bundle identifier |
| `frontendDist` | `../src` | Direktori frontend yang di-bundle |
| `withGlobalTauri` | `true` | Expose `window.__TAURI__` ke JS |
| `window.label` | `main` | Label window (diperlukan IPC command `toggle_fullscreen`) |
| `window.width/height` | `1024×600` | Sesuai resolusi layar robot |
| `window.fullscreen` | `false` | Mulai dalam mode jendela; F11 untuk fullscreen |
| `window.decorations` | `true` | Title bar OS aktif (bisa dimatikan untuk kiosk) |
| `window.backgroundColor` | `#CBD8E2` | Warna latar belakang jendela sebelum HTML render |
| `security.csp` | `null` | CSP dinonaktifkan (memungkinkan load aset lokal) |
| `bundle.active` | `true` | Aktifkan bundle packaging |
| `bundle.targets` | `all` | Build semua format distribusi yang tersedia |

---

### `src-tauri/capabilities/default.json`
**Izin Tauri IPC yang diizinkan untuk window `main`.**

Izin yang diberikan:
- `core:default` — akses API Tauri dasar
- `core:event:default`, `allow-listen`, `allow-unlisten`, `allow-emit` — subscribe/emit event
- `core:window:allow-start-dragging` — drag window
- `core:app:allow-app-show` — tampilkan app window

---

## Konfigurasi

### `src/config/config.json`
Dikonsumsi oleh `main.js` saat startup. Berisi:
- `canvas` — dimensi kanvas dasar (800×480)
- `colors` — warna background dan garis
- `backside` — aset dan koordinat latar belakang
- `expressions` — per ekspresi: koordinat dan aset `eyeL`, `eyeR`, `mouth`, `blushL`, `blushR`, `tearL`, `tearR`, `effect`
- `visemes` — mapping kode viseme ke path aset SVG
- `visemePositions` — koordinat dan dimensi tiap posisi mulut viseme
- `blink` — `minIntervalMs`, `maxIntervalMs`, `durationMs`
- `mode` — `mode_statis_aktif`, `default_mode`

### `src/config/keymap.json`
- `toggleMode` — key untuk toggle mode (default `F2`)
- `togglePanel` — key untuk toggle panel (default `F3`)
- `expressions` — mapping `"1"–"9"` ke nama ekspresi
- `visemes` — mapping `"q"–"g"` ke kode viseme

> **Override lokal:** Buat `src/config/config.local.json` untuk override sebagian config tanpa mengubah file utama. File ini tidak di-commit ke repo.

---

## Ekspresi & Aset SVG

| Ekspresi (English) | Alias Indonesia | Mata | Mulut | Overlay |
|---|---|---|---|---|
| `idle` | `netral` | MATA.svg (normal) | IDLE.svg | — |
| `happy` | `senang` | MATA.svg | HAPPIER.svg | — |
| `happier` | `sangat_senang` | HAPPIER EYE.svg | HAPPIER.svg | Blush kiri+kanan |
| `happier_transisi` | `sangat_senang_transisi` | MATA HAPPIER TRANSITION (kiri/kanan terpisah) | HAPPIER.svg | — |
| `sad` | `sedih` | SAD EYE LEFT/RIGHT.svg | SAD MOUTH.svg | — |
| `cry` | `menangis` | CRY EYE LEFT/RIGHT.svg | CRY MOUTH.svg | Air mata + animasi aliran |
| `shock` | `terkejut` | MATA.svg | SHOCK.svg | Tanda seru melayang |
| `thinking` | `berpikir` | LOAD EYE.svg (kiri) + MATA.svg (kanan) | LOAD MOUTH.svg | Tanda tanya melayang |
| `timeout` | — | TIMEOUT EYE LEFT/RIGHT.svg (berputar) | TIMEOUT MOUTH.svg | Rotasi berkelanjutan |

---

## Protokol MQTT

### Format Pesan Ekspresi
```json
{
  "tipe": "ekspresi",
  "emosi": "happy",
  "intensitas": 1.0,
  "durasi_ms": 3000,
  "id": "opsional"
}
```

### Format Pesan Viseme
```json
{
  "tipe": "viseme",
  "id": "unik",
  "jadwal": [
    { "t": 0.0, "v": "A" },
    { "t": 0.3, "v": "REST" },
    { "t": 0.6, "v": "DIAM" }
  ]
}
```

### Format Pesan Bicara
```json
{ "tipe": "bicara", "status": "mulai" }
{ "tipe": "bicara", "status": "selesai" }
```

**Topics:** `brone/face/ekspresi` · `brone/face/viseme` · `brone/face/bicara`

---

## Mode Operasi

| Mode | Deskripsi |
|---|---|
| **Dinamis** (default) | Ekspresi dikontrol dari MQTT. Input keyboard diabaikan kecuali F2. |
| **Statis** | Ekspresi dikontrol manual via keyboard atau panel. Pesan MQTT diabaikan. |

Toggle: **F2** (atau klik "Ganti Mode" di panel).

---

## Kontrol Aplikasi

| Input | Aksi |
|---|---|
| **F11** | Toggle layar penuh ↔ jendela |
| **F2** | Toggle mode Dinamis ↔ Statis |
| **F3** | Toggle panel kontrol (hanya di mode statis) |
| **Escape** / **Ctrl+Q** | Keluar aplikasi |
| **1–9** | Set ekspresi (hanya di mode statis) |
| **A, I, U, E, O, R (REST), D (DIAM)** | Set viseme mulut manual (hanya di mode statis) |
| Mouse ke pojok atas (<80px) | Tampilkan tombol ⛶ (fullscreen) dan ✕ (tutup) selama 2.5 detik |

---

## Testing

```bash
# Jalankan semua unit test frontend
node --test tests/fe/*.test.js

# Output yang diharapkan:
# ℹ tests 26
# ℹ pass 26
# ℹ fail 0
```

| File Test | Modul yang Diuji |
|---|---|
| `blink.test.js` | `BlinkController` — interval, factor curve |
| `connector.test.js` | `initConnector` — alias, deduplikasi, routing payload |
| `interpolator.test.js` | `lerp`, `Interpolator`, `EASING` |
| `mode.test.js` | `ModeManager` — mode switch, filter pesan |
| `transition.test.js` | Transisi ekspresi — kedip + mulut datar |
| `viseme.test.js` | `visemeAt` — pemilihan dari jadwal |

---

## Deploy ke Robot

**Spesifikasi:** Intel NUC · Ubuntu 22.04.4 LTS · x86_64 · Layar 1024×600 · Wayland

```bash
# Di robot — update kode
cd ~/brone_face_ascar
git pull origin main
cargo tauri build

# Jalankan (wajib GDK_BACKEND=x11 untuk Wayland)
GDK_BACKEND=x11 DISPLAY=:0 ./src-tauri/target/release/brone-gui
```

Lihat [Deploy Guide lengkap](docs/DEPLOY.md) untuk prasyarat, setup systemd, troubleshooting, dan test MQTT.

---

## Variabel Environment

| Variabel | Default | Deskripsi |
|---|---|---|
| `BRONE_MQTT_HOST` | `127.0.0.1` | IP address MQTT broker |
| `BRONE_MQTT_PORT` | `1883` | Port MQTT broker |
| `RUST_LOG` | `info` | Level log Rust (`debug`, `info`, `warn`, `error`) |
| `GDK_BACKEND` | — | Set `x11` agar Tauri jalan di Wayland |
| `DISPLAY` | — | Set `:0` jika berjalan tanpa sesi display aktif |
