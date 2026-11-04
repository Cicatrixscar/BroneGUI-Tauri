// Memilih viseme aktif dari jadwal, berdasarkan waktu audio.
// Belum diimplementasikan. Lihat docs/CONTRACT.md.
export function visemeAt(jadwal, t) {
  let aktif = 'DIAM';
  for (const item of jadwal) {
    if (item.t <= t) aktif = item.v;
    else break;
  }
  return aktif;
}
