#!/bin/bash
# Installs Qwen3-ASR (MLX) into asr/.venv and downloads the model.
# Usage: npm run setup:asr [-- Qwen/Qwen3-ASR-0.6B]
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${1:-Qwen/Qwen3-ASR-1.7B}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Qwen3-ASR через MLX работает только на Mac с Apple Silicon (M1 и новее)." >&2
  exit 1
fi

PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    PY="$c"; break
  fi
done
if [[ -z "$PY" ]]; then
  echo "Нужен Python 3.10+. Установите: brew install python@3.12 — и запустите снова." >&2
  exit 1
fi

echo "→ Python: $($PY --version)"
"$PY" -m venv asr/.venv
asr/.venv/bin/pip install -q --upgrade pip
asr/.venv/bin/pip install -q -r asr/requirements.txt
echo "→ Скачиваю модель $MODEL (один раз)…"
asr/.venv/bin/python -c "from mlx_qwen3_asr import Session; Session(model='$MODEL'); print('OK')"
echo "Готово. Перезапустите приложение: npm run dev"
