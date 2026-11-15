"""Local web server for the party visuals. Run:  python serve.py  [--page hologram.html] [--port 8080] [--no-open]
Serves this folder on http://localhost:<port>/ (localhost counts as a secure context, so the browser allows
microphone/interface input). The page opens in the default browser.
"""
import argparse
import functools
import http.server
import json
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows' registry sometimes maps .js to text/plain, which breaks ES modules: force the right types
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
                      ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".wasm": "application/wasm"}

    def do_GET(self):
        # /api/dancers -> the Mixamo files in assets/dancers: the character (with skin) + moves/*.fbx (without skin)
        if self.path.split("?")[0] in ("/api/memory", "/api/calib"):
            f = self._memory_file() if self.path.startswith("/api/memory") else self._calib_file()
            body = f.read_bytes() if f.exists() else b"{}"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?")[0] == "/api/dancers":
            base = ROOT / "assets" / "dancers"
            # the character: character.fbx/.glb if present, else any other .fbx/.glb directly in assets/dancers
            found = sorted(p for p in base.glob("*") if p.suffix.lower() in (".fbx", ".glb")) if base.exists() else []
            character = next((p for p in found if p.stem.lower() == "character"), found[0] if found else None)
            moves = (sorted(m for m in (base / "moves").glob("*") if m.suffix.lower() in (".fbx", ".glb"))
                     if (base / "moves").exists() else [])
            pools = {}
            if (base / "moves.json").exists():           # which moves for which moment (editable by hand)
                try:
                    pools = json.loads((base / "moves.json").read_text(encoding="utf-8"))
                except ValueError as err:
                    print(f"moves.json is not valid JSON: {err}")
            body = json.dumps({
                "character": character.relative_to(ROOT).as_posix() if character else None,
                "moves": [m.relative_to(ROOT).as_posix() for m in moves],
                "pools": pools,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    # /api/memory -> the show's memory (motifs it has seen and what it did with them), kept in memory/memory.json
    def _memory_file(self):
        d = ROOT / "memory"
        d.mkdir(exist_ok=True)
        return d / "memory.json"

    # /api/calib -> the screens' calibration (hologram picture, projector picture + where the cube is), memory/calib.json;
    # each window posts only its own part ({"holo": {...}} or {"wall": {...}}), merged here
    def _calib_file(self):
        return self._memory_file().with_name("calib.json")

    def do_POST(self):
        if self.path.split("?")[0] == "/api/calib":
            n = int(self.headers.get("Content-Length", 0) or 0)
            try:
                part = json.loads(self.rfile.read(n))
                f = self._calib_file()
                data = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
                data.update(part)
                tmp = f.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
                tmp.replace(f)
                self.send_response(204)
            except ValueError:
                self.send_response(400)
            self.end_headers()
            return
        if self.path.split("?")[0] == "/api/memory":
            n = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(n)
            try:
                json.loads(body)                                 # only store valid JSON
                f = self._memory_file()
                tmp = f.with_suffix(".tmp")
                tmp.write_bytes(body)
                tmp.replace(f)                                   # atomic: a crash never leaves half a file
                self.send_response(204)
            except ValueError:
                self.send_response(400)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")      # always load the latest files while developing
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--page", default="hologram.html")
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Handler, directory=str(ROOT)))
    url = f"http://localhost:{a.port}/{a.page}"
    print(f"Serving {ROOT} at {url}  (Ctrl+C to stop)")
    if not a.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
