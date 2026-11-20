# Panduan Perbaikan Bug Ekspresi & Format Pengiriman MQTT untuk Tim LLM (`brone-talk-nuc`)

Dokumen ini ditujukan untuk **Tim LLM / Text-to-Speech (Intel NUC)** guna menyelesaikan kendala ekspresi robot yang selalu menampilkan muka bingung (*confused*) saat berbicara, serta sebagai panduan format payload MQTT untuk 3 mode viseme GUI.

---

## 1. Analisis Masalah: Kenapa Wajah Robot Selalu Bingung (*Confused*) Saat Bicara?

Saat pengujian menggunakan mikrofon, wajah robot berubah menjadi `confused` (mata kiri berputar tanda sedang berpikir) saat mendengarkan dan memproses teks. Namun, **ketika suara speaker mulai membalas jawaban, wajah robot tidak berganti emosi dan tetap nyangkut di muka `confused`**.

### Penyebab di Kode Asli NUC (`brone_talk.py` baris 1796–1823):

```python
def say(self, text: str, expression: str) -> bool:
    self.telemetry.stage("tts", "start")
    path: Path | None = None
    try:
        path, synth_ms, duration_s = self.synthesize(text)
        
        # ❌ MASALAH 1: Mengirim kata "speaking", bukan emosi asli
        self.telemetry.expression("speaking", duration_s)
        
        played = False
        if self.playback_enabled:
            # 🔊 Audio diputar di speaker selama 3-5 detik di sini:
            self.play(path)
            played = True
        ...
    finally:
        if path is not None:
            path.unlink(missing_ok=True)
            
        # ❌ MASALAH 2: Emosi asli (misal "happy") baru dikirim SETELAH audio mati
        self.telemetry.expression(expression)
```

### Mengapa Ini Terjadi?
1. Saat LLM mulai berpikir, NUC mem-publish `robot/voice_stage` dengan `state: "start", stage: "llm"`. GUI menerjemahkan ini menjadi ekspresi **`confused` (mata loading)**. Ini normal.
2. Ketika giliran suara speaker berbunyi, NUC mengirim `"expression": "speaking"`.
   * Di GUI, kata `"speaking"` **bukan nama emosi**, melainkan penanda audio dimulai.
   * Karena bukan nama emosi, wajah robot **tidak berganti emosi dan tetap tertahan di muka `confused`** sepanjang audio berbunyi.
3. Emosi aslinya (misal `"happy"`) baru dikirim di baris 1822 di dalam blok `finally:` (setelah `self.play(path)` selesai). Begitu suara mati, emosi baru sempat muncul sepersekian detik sebelum langsung ditimpa kembali ke `idle`.

---

## 2. Solusi: Patch 1 Baris di Intel NUC (`brone_talk.py`)

Cukup pindahkan pengiriman emosi asli ke **sebelum audio diputar**, dan sertakan durasi audionya.

### File: `~/brone-talk/brone_talk.py` (pada method `Speaker.say`)

#### 🔴 SEBELUMNYA:
```python
        try:
            path, synth_ms, duration_s = self.synthesize(text)
            self.telemetry.expression("speaking", duration_s)  # <-- Baris 1801
            played = False
            if self.playback_enabled:
                self.play(path)
                played = True
```

#### 🟢 UBAH MENJADI:
```python
        try:
            path, synth_ms, duration_s = self.synthesize(text)
            # Kirim emosi asli (happy, sad, dll) beserta durasi audio tepat sebelum speaker bunyi:
            self.telemetry.expression(expression, duration_s)
            played = False
            if self.playback_enabled:
                self.play(path)
                played = True
```

*(Di bagian bawah method `say()`, baris `self.telemetry.expression(expression)` yang ada di blok `finally:` baris 1822 **bisa dihapus atau dikomentari** karena sudah dikirim di awal).*

---

## 3. Format Payload MQTT yang Harus Dikirim LLM (Sesuai Mode GUI)

GUI Brone mendukung 3 mode viseme. Tim LLM dapat memilih salah satu format di bawah ini:

### Mode 1: Fallback (Paling Mudah & Langsung Kompatibel Hari Ini)
> *Gunakan mode ini jika tim LLM belum sempat mengintegrasikan pemecah suku kata/viseme. Cukup kirim emosi dan durasi, mulut robot akan otomatis buka-tutup (`O` $\leftrightarrow$ `REST`) di GUI.*

* **Topik MQTT:** `robot/expression`
* **Waktu Kirim:** 1x, tepat sebelum fungsi `self.play(path)` dipanggil.
* **Payload JSON:**
  ```json
  {
    "expression": "happy",
    "duration": 4.5
  }
  ```
  *(Nilai `expression` bisa berupa: `happy`, `sad`, `excited`, `confused`, `neutral`, dll. Nilai `duration` adalah durasi file audio dalam satuan detik).*

---

### Mode 2: Streaming Kata (Word-by-Word Streaming)
> *Gunakan mode ini jika LLM mengalirkan kata demi kata saat audio dimainkan. GUI akan otomatis memecah fonetik per-kata secara real-time.*

1. **Awal Kalimat (Set Emosi & Master Deadline):**
   * **Topik:** `robot/expression`
   * **Payload:**
     ```json
     {
       "expression": "happy",
       "duration": 5.2
     }
     ```
2. **Saat Tiap Kata Mulai Terucap:**
   * **Topik:** `robot/word`
   * **Payload:**
     ```json
     { "word": "Halo" }
     ```
     *(Kirim kata berikutnya saat kata berikutnya mulai terucap di speaker, misal: `{"word": "aku"}`, `{"word": "BCA"}`).*
3. **Saat Audio Selesai:**
   * **Topik:** `robot/voice_stage`
   * **Payload:**
     ```json
     { "stage": "tts", "state": "end" }
     ```

---

### Mode 3: Bawaan (Jadwal Viseme Lengkap)
> *Gunakan mode ini jika sistem TTS menghasilkan timestamp fonetik lengkap di awal kalimat.*

* **Topik MQTT:** `robot/expression`
* **Waktu Kirim:** 1x sebelum audio berbunyi.
* **Payload JSON:**
  ```json
  {
    "expression": "happy",
    "duration": 3.0,
    "viseme": [
      { "t": 0.00, "v": "REST" },
      { "t": 0.15, "v": "A" },
      { "t": 0.45, "v": "O" },
      { "t": 0.80, "v": "REST" },
      { "t": 1.20, "v": "A" },
      { "t": 3.00, "v": "DIAM" }
    ]
  }
  ```

---

## 4. Checklist Uji Coba

1. [ ] Buka `brone_talk.py` di Intel NUC.
2. [ ] Ubah `self.telemetry.expression("speaking", duration_s)` menjadi `self.telemetry.expression(expression, duration_s)`.
3. [ ] Simpan file dan restart `brone_talk.py`.
4. [ ] Ucapkan pertanyaan ke mikrofon (misal: *"Halo Brone"*).
5. [ ] **Verifikasi Hasil:**
   * Saat LLM berpikir $\rightarrow$ Wajah `confused`.
   * Saat speaker mulai menjawab $\rightarrow$ Wajah **langsung berubah menjadi emosi jawaban (misal `happy`)**, mulut otomatis bergerak buka-tutup selama suara berbunyi, lalu tersenyum diam selama 5 detik sebelum kembali netral.
