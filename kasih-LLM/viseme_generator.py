"""
Modul Generator Viseme (Bentuk Mulut) Bahasa Indonesia untuk BRONE Robot.
Digunakan oleh tim LLM / Suara (brone-talk-nuc) untuk menghasilkan timestamp gerak mulut
yang sinkron dengan audio Piper TTS sebelum dipublish ke MQTT Jetson.

Format yang dihasilkan sesuai dengan kontrak BroneGUI-Tauri (7 Viseme Atomik):
- Vokal: 'A', 'I', 'U', 'E', 'O'
- Katup Bibir / Bilabial / Jeda: 'REST'
- Diam / Netral: 'DIAM'
"""

import re
from typing import Any

# Huruf vokal bahasa Indonesia
VOWELS = set("aiueo")

# Konsonan bilabial (kedua bibir harus mengatup rapat sebelum berbunyi)
BILABIALS = set("pbm")

# Tanda baca penanda jeda napas / koma / titik
PUNCTUATION_PAUSE = {",": 0.25, ";": 0.25, ".": 0.4, "!": 0.35, "?": 0.4}


def generate_visemes_from_text(text: str, duration_s: float) -> list[dict[str, Any]]:
    """
    Mengubah teks jawaban dan durasi audio (detik) menjadi daftar timestamp viseme.
    
    Menggunakan prinsip pembobotan fonetik bahasa Indonesia:
    1. Vokal (A, I, U, E, O) membuka bentuk mulut sesuai karakter vokal.
    2. Konsonan bilabial (P, B, M) dan jeda spasi mengatupkan bibir (REST).
    3. Suku kata di akhir kata / sebelum tanda baca diberi bobot waktu lebih panjang
       (mengikuti intonasi ayunan suara alami manusia & TTS).
    4. Mulut mengatup ke REST sebelum durasi berakhir, lalu DIAM tepat saat audio habis.
    """
    clean_text = text.strip()
    if not clean_text or duration_s <= 0.1:
        return [{"t": 0.0, "v": "DIAM"}]

    tokens: list[tuple[str, float]] = []  # (viseme_code, relative_weight)

    # Selalu mulai dari posisi katup siap bicara (REST)
    tokens.append(("REST", 0.5))

    words = clean_text.split()
    for w_idx, raw_word in enumerate(words):
        word_lower = raw_word.lower()
        chars = list(word_lower)
        i = 0
        n = len(chars)

        while i < n:
            ch = chars[i]

            # Cek tanda baca jeda
            if ch in PUNCTUATION_PAUSE:
                tokens.append(("REST", PUNCTUATION_PAUSE[ch] * 3.0))
                i += 1
                continue

            # Cek konsonan bilabial (P, B, M) -> bibir mengatup
            if ch in BILABIALS:
                tokens.append(("REST", 0.8))
                i += 1
                continue

            # Cek vokal (A, I, U, E, O)
            if ch in VOWELS:
                vokal_code = ch.upper()
                # Jika vokal berada di akhir kata, beri bobot lebih panjang (ayunan suku kata akhir)
                is_last_in_word = (i == n - 1 or (i == n - 2 and chars[i + 1] in PUNCTUATION_PAUSE))
                weight = 1.6 if is_last_in_word else 1.0

                # Hindari duplikasi viseme identik berurutan tanpa jeda
                if tokens and tokens[-1][0] == vokal_code:
                    # Perpanjang bobot vokal sebelumnya daripada membuat lompatan ganda
                    tokens[-1] = (vokal_code, tokens[-1][1] + weight * 0.8)
                else:
                    tokens.append((vokal_code, weight))
                i += 1
                continue

            # Konsonan lain (D, T, K, S, R, dll) tidak mengubah viseme secara drastis
            i += 1

        # Jeda katup bibir tipis antar kata
        if w_idx < len(words) - 1:
            tokens.append(("REST", 0.6))

    # Penutup di akhir bicara
    tokens.append(("REST", 0.8))

    # Hitung total bobot dan konversikan ke timestamp detik (0.0 sampai duration_s)
    total_weight = sum(w for _, w in tokens)
    if total_weight <= 0:
        return [{"t": 0.0, "v": "DIAM"}]

    # Sisakan 0.05 detik terakhir untuk DIAM
    usable_duration = max(0.05, duration_s - 0.05)
    scale = usable_duration / total_weight

    jadwal: list[dict[str, Any]] = []
    current_time = 0.0

    for viseme_code, weight in tokens:
        t_rounded = round(current_time, 3)
        # Jangan tambahkan jika timestamp persis sama dengan sebelumnya
        if not jadwal or jadwal[-1]["t"] != t_rounded or jadwal[-1]["v"] != viseme_code:
            jadwal.append({"t": t_rounded, "v": viseme_code})
        current_time += weight * scale

    # Titik akhir penutup
    jadwal.append({"t": round(duration_s, 3), "v": "DIAM"})
    return jadwal


def create_speech_payload(expression: str, duration_s: float, text: str = "") -> dict[str, Any]:
    """
    Membuat payload JSON gabungan yang dikirim ke topik MQTT `robot/expression`.
    
    Contoh output:
    {
      "expression": "happy",
      "duration": 3.2,
      "viseme": [
        {"t": 0.0, "v": "REST"},
        {"t": 0.15, "v": "A"},
        {"t": 0.45, "v": "O"},
        ...
        {"t": 3.2, "v": "DIAM"}
      ]
    }
    """
    viseme_schedule = generate_visemes_from_text(text, duration_s)
    return {
        "expression": expression,
        "duration": round(duration_s, 2),
        "viseme": viseme_schedule,
    }


if __name__ == "__main__":
    # Uji coba mandiri
    test_text = "Halo, selamat pagi! Nama saya Bron, ada yang bisa saya bantu?"
    durasi_contoh = 3.5  # detik

    payload = create_speech_payload("happy", durasi_contoh, test_text)
    print("Contoh Payload Siap MQTT:")
    import json
    print(json.dumps(payload, indent=2))
