#!/usr/bin/env bash
# Mengukur RAM dan CPU proses sekali per detik selama DURASI detik.
# Pemakaian: ./sample_resources.sh <nama_proses> <durasi_detik> <nama_file_csv>
# Contoh:    ./sample_resources.sh brone-gui 60 results/tauri_run1.csv
set -euo pipefail

PROSES="${1:?nama proses}"
DURASI="${2:-60}"
OUT="${3:-results/run.csv}"

mkdir -p "$(dirname "$OUT")"
echo "detik,rss_kb,cpu_persen" > "$OUT"

for ((i = 1; i <= DURASI; i++)); do
  # ambil semua PID dengan nama proses tersebut, jumlahkan RSS dan CPU
  read -r rss cpu < <(ps -C "$PROSES" -o rss=,pcpu= 2>/dev/null \
    | awk '{rss+=$1; cpu+=$2} END {printf "%d %.2f\n", rss, cpu}')
  echo "$i,${rss:-0},${cpu:-0}" >> "$OUT"
  sleep 1
done

echo "selesai: $OUT"
