#!/usr/bin/env bash
# Local speech to text for voice input (D46): whisper.cpp's whisper-server with the ggml base model.
#   bun run voice:setup   clone and build whisper.cpp, download ggml-base.bin (once)
#   bun run voice         start whisper-server on the host/port in VOICE_URL (default 127.0.0.1:8178)
# Audio is personal data: the server only listens on loopback, and temporary files go to RAM (/dev/shm).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${WHISPER_DIR:-$ROOT/data/whisper.cpp}"
MODEL="${WHISPER_MODEL:-base}"
BIN="$DIR/build/bin/whisper-server"
MODEL_FILE="$DIR/models/ggml-$MODEL.bin"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. Install it first: $2" >&2; exit 1; }; }

setup() {
  need git "sudo apt install git"
  need cmake "sudo apt install cmake build-essential"
  need ffmpeg "sudo apt install ffmpeg (whisper-server --convert uses it to read browser audio)"
  if [ ! -d "$DIR/.git" ]; then
    mkdir -p "$(dirname "$DIR")"
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$DIR"
  fi
  cmake -S "$DIR" -B "$DIR/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$DIR/build" -j --config Release --target whisper-server
  [ -f "$MODEL_FILE" ] || bash "$DIR/models/download-ggml-model.sh" "$MODEL"
  echo "Ready: $BIN with $MODEL_FILE. Start it with: bun run voice"
}

run() {
  need ffmpeg "sudo apt install ffmpeg"
  [ -x "$BIN" ] && [ -f "$MODEL_FILE" ] || { echo "whisper-server isn't built yet. Run: bun run voice:setup" >&2; exit 1; }
  local url="${VOICE_URL:-}"
  if [ -z "$url" ] && [ -f "$ROOT/.env" ]; then
    url="$(grep -E '^VOICE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d '"' || true)"
  fi
  url="${url:-http://127.0.0.1:8178}"
  local hostport="${url#*://}"; hostport="${hostport%%/*}"
  local host="${hostport%:*}" port="${hostport##*:}"
  case "$host" in localhost | 127.* | "[::1]" | ::1) ;; *) echo "VOICE_URL must be a loopback address (got $host)" >&2; exit 1 ;; esac
  local tmp="/dev/shm/leasing-whisper"; mkdir -p "$tmp" 2>/dev/null || tmp="$(mktemp -d)"
  exec "$BIN" -m "$MODEL_FILE" --host "$host" --port "$port" --convert --tmp-dir "$tmp" -l auto
}

case "${1:-run}" in
  setup) setup ;;
  run) run ;;
  *) echo "usage: whisper.sh [setup|run]" >&2; exit 2 ;;
esac
