"""Local Qwen3-ASR server for Ghost Claude.

Started by the Electron main process. Listens on 127.0.0.1 only, on a random
port, and requires the token from GHOST_ASR_TOKEN. Accepts raw 16 kHz mono
float32 PCM and returns the transcript as JSON.

Prints "READY <port>" to stdout once the model is loaded.
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from mlx_qwen3_asr import Session

MODEL = os.environ.get("GHOST_ASR_MODEL", "Qwen/Qwen3-ASR-1.7B")
TOKEN = os.environ.get("GHOST_ASR_TOKEN", "")

print(f"LOADING {MODEL}", flush=True)
session = Session(model=MODEL)
# Warm up so the first real phrase isn't slow.
session.transcribe(np.zeros(16000, dtype=np.float32))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "model": MODEL})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self._send(401, {"error": "unauthorized"})
        url = urlparse(self.path)
        if url.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        q = parse_qs(url.query)
        language = q.get("language", ["auto"])[0]
        context = q.get("context", [""])[0]
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        audio = np.frombuffer(raw, dtype="<f4").copy()
        started = time.time()
        try:
            result = session.transcribe(
                audio,
                language=None if language == "auto" else language,
                context=context,
            )
        except Exception as e:  # report instead of killing the server
            return self._send(500, {"error": str(e)})
        self._send(200, {"text": result.text.strip(), "language": result.language, "ms": int((time.time() - started) * 1000)})


server = HTTPServer(("127.0.0.1", 0), Handler)
print(f"READY {server.server_address[1]}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    sys.exit(0)
