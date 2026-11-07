#!/bin/bash
# Load test on the server itself, against a THROWAWAY copy of the app: same image, same memory limit,
# its own empty database in a temporary folder. The family's app, data and tunnel are not touched.
# Run as root (through SSM, like deploy.sh):  /opt/kuribotas/loadtest.sh [phase ...]
# A phase is PEOPLExEVERYxSECONDS (server/src/loadtest.ts); the default is a busy family evening and
# then three times the family. Prints each phase's delivery times, the copy's peak memory and CPU, and
# the machine's free memory before and during.
set -euo pipefail
cd /opt/kuribotas
phases=("$@")
[ ${#phases[@]} -gt 0 ] || phases=(50x10x60 150x5x60)

image="ghcr.io/rugerious/kuribotas/server:$(sed -n 's/^KURIBOTAS_TAG=//p' .env)"
work=$(mktemp -d)
chown 1000:1000 "$work"
cleanup() {
  [ -n "${sampler:-}" ] && kill "$sampler" 2>/dev/null || true
  docker rm -f kb-load kb-load-people >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "== machine memory before (MiB)"
free -m | sed -n 1,2p
docker run -d --name kb-load --user 1000 --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 300m \
  -e DATA_DIR=/data -e PORT=3999 -e PUBLIC_URL=http://127.0.0.1:3999 -v "$work:/data" "$image" >/dev/null
sleep 3

# Every 2 s while the fake people talk (they run in their own container): the copy's memory (MiB) and
# CPU (% of one core), and the machine's used and available memory (MiB).
(
  while true; do
    app=$(docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' kb-load 2>/dev/null | awk '{
      m = $1; v = m + 0; if (m ~ /GiB/) v *= 1024; else if (m ~ /KiB/) v /= 1024; else if (m ~ /[^i]B$/ && m !~ /MiB/) v /= 1048576
      c = $4; sub(/%/, "", c); printf "%.1f %s", v, c }')
    mem=$(free -m | awk '/^Mem:/ { print $3, $7 }')
    [ -n "$app" ] && echo "$app $mem"
    sleep 2
  done
) >"$work/stats" &
sampler=$!

docker run --name kb-load-people --network container:kb-load --user 1000 --read-only --cap-drop ALL \
  --memory 300m -e DATA_DIR=/data -e PORT=3999 -v "$work:/data" "$image" \
  node server/src/loadtest.ts "${phases[@]}"

kill "$sampler" 2>/dev/null || true
echo "== peaks over $(wc -l <"$work/stats") samples"
awk 'NR == 1 || $1 > m { m = $1 } $2 > c { c = $2 } $3 > u { u = $3 } NR == 1 || $4 < a { a = $4 }
  END { printf "app copy: memory %.0f MiB of 300, cpu %s%% of one core\nmachine: used up to %d MiB, available down to %d MiB\n", m, c, u, a }' "$work/stats"
