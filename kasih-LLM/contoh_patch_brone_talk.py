"""
CONTOH PATCH INTEGRASI UNTUK TIM LLM (brone-talk-nuc)
File target: brone_talk.py (di Intel NUC)

Cara integrasi sangat mudah:
1. Copy file `viseme_generator.py` ke folder project `~/brone-talk/` di NUC.
2. Di `brone_talk.py`, import fungsi:
       from viseme_generator import create_speech_payload
3. Ubah method `say()` pada class `Speaker` seperti contoh di bawah ini:
"""

# ==============================================================================
# SEBELUMNYA (brone_talk.py baris 1796-1823):
# ==============================================================================
"""
    def say(self, text: str, expression: str) -> bool:
        self.telemetry.stage("tts", "start")
        path: Path | None = None
        try:
            path, synth_ms, duration_s = self.synthesize(text)
            self.telemetry.expression("speaking", duration_s)  # <-- Masalah: kirim "speaking" tanpa emosi dan viseme
            played = False
            if self.playback_enabled:
                self.play(path)  # <-- Audio bunyi 3-4 detik di sini
                played = True
            ...
        finally:
            if path is not None:
                path.unlink(missing_ok=True)
            self.telemetry.expression(expression)  # <-- Masalah: baru kirim "happy" setelah suara mati
"""

# ==============================================================================
# SESUDAHNYA (YANG DISARANKAN):
# ==============================================================================
"""
    def say(self, text: str, expression: str) -> bool:
        self.telemetry.stage("tts", "start")
        path: Path | None = None
        try:
            path, synth_ms, duration_s = self.synthesize(text)
            
            # --- [BARU: GENERATE PAYLOAD LENGKAP & PUBLISH KE MQTT] ---
            # Menghasilkan payload: ekspresi + durasi + jadwal viseme kata-kata
            payload = create_speech_payload(
                expression=expression, 
                duration_s=duration_s, 
                text=text
            )
            # Kirim paket lengkap ke MQTT Jetson tepat sebelum speaker berbunyi:
            self.telemetry.publish("robot/expression", payload)
            # ----------------------------------------------------------

            played = False
            if self.playback_enabled:
                self.play(path)  # Audio berbunyi, layar robot sudah sinkron bergerak!
                played = True

            self.telemetry.stage(
                "tts",
                "done",
                ms=round(synth_ms),
                audio_s=round(duration_s, 2),
                played=played,
            )
            LOG.info("TTS %.2fs (audio=%.2fs, played=%s): %r", synth_ms / 1000, duration_s, played, text[:120])
            return played
        except Exception as exc:
            self.telemetry.stage("error", "tts", detail=str(exc)[:200])
            LOG.exception("TTS atau playback gagal")
            return False
        finally:
            if path is not None:
                path.unlink(missing_ok=True)
            # Tidak perlu kirim expression lagi di sini karena GUI sudah otomatis
            # menahan ekspresi (hold) selama beberapa detik lalu kembali ke idle!
"""
