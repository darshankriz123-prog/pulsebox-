"""Local YouTube audio fetcher and static website server for Pulsebox.

Requires Python and yt-dlp. The browser's bundled FFmpeg converts to MP3.
"""
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
TEMP_ROOT = ROOT / "server" / ".cache"
TEMP_ROOT.mkdir(exist_ok=True)
ALLOWED_ORIGINS = {"http://127.0.0.1:4173", "http://localhost:4173", "https://darshankriz123-prog.github.io"}
if os.environ.get("ALLOWED_ORIGIN"):
    ALLOWED_ORIGINS.add(os.environ["ALLOWED_ORIGIN"])
HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
MAX_REQUEST = 4096
TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"}


class Handler(BaseHTTPRequestHandler):
    def headers_for_origin(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def send_json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.headers_for_origin()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        if self.path != "/api/convert":
            self.send_error(404)
            return
        self.send_response(204)
        self.headers_for_origin()
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True})
            return
        target = (ROOT / self.path.split("?", 1)[0].lstrip("/")).resolve()
        if not target.is_relative_to(ROOT):
            self.send_error(403)
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file() or (ROOT / "server") in target.parents:
            self.send_error(404)
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        target = (ROOT / self.path.split("?", 1)[0].lstrip("/")).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file() or (ROOT / "server") in target.parents:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(target.stat().st_size))
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/convert":
            self.send_error(404)
            return
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:
            self.send_json(403, {"error": "Origin not allowed"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size < 1 or size > MAX_REQUEST:
            self.send_json(413, {"error": "Invalid request size"})
            return
        try:
            payload = json.loads(self.rfile.read(size))
            url = payload.get("url", "")
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.hostname not in HOSTS or parsed.username or parsed.password:
                raise ValueError("Enter a valid YouTube video link")
        except (json.JSONDecodeError, ValueError, AttributeError):
            self.send_json(400, {"error": "Enter a valid YouTube video link"})
            return
        try:
            with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as folder:
                output = Path(folder) / "audio.%(ext)s"
                command = [
                    sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings", "--no-progress",
                    "--match-filter", "duration <= 1800", "--max-filesize", "100M",
                    "--socket-timeout", "15", "--retries", "2",
                    "-f", "bestaudio[ext=m4a]/bestaudio",
                    "-o", str(output), url,
                ]
                result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
                matches = list(Path(folder).glob("audio.*"))
                if result.returncode or not matches:
                    raise RuntimeError("Could not convert this YouTube video. It may be unavailable, too long, or restricted.")
                output = matches[0]
                data = output.read_bytes()
                if len(data) > 100 * 1024 * 1024:
                    raise RuntimeError("Converted audio is too large")
                self.send_response(200)
                self.headers_for_origin()
                self.send_header("Content-Type", "audio/mp4" if output.suffix == ".m4a" else "audio/webm")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-Source-Ext", output.suffix.lstrip("."))
                self.send_header("Access-Control-Expose-Headers", "X-Source-Ext")
                self.end_headers()
                self.wfile.write(data)
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "Conversion timed out. Try a shorter video."})
        except (RuntimeError, OSError) as exc:
            self.send_json(422, {"error": str(exc)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "4173"))
    host = os.environ.get("HOST", "127.0.0.1")
    ThreadingHTTPServer((host, port), Handler).serve_forever()

