"""Local integration server: real HTTP delay/rate limits on test media only."""
import json
import threading
import time
from collections import defaultdict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
LOCK = threading.Lock()
STATS = defaultdict(lambda: {'requests': 0, 'bytes': 0, 'active': 0, 'peak': 0})


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        if not self.path.startswith('/__media__/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        url = urlsplit(self.path)
        run = parse_qs(url.query).get('run', ['default'])[0]
        if url.path == '/__stats__':
            with LOCK:
                body = json.dumps(dict(STATS[run])).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not url.path.startswith('/__media__/'):
            return super().do_GET()
        parts = url.path.split('/')
        if len(parts) != 4 or parts[2] not in ('slow', 'fast'):
            return self.send_error(404)
        path = ROOT / '.work' / 'cases' / 'media' / parts[3]
        if path.suffix != '.jpg' or not path.is_file() or path.resolve().parent != (ROOT / '.work/cases/media').resolve():
            return self.send_error(404)
        with LOCK:
            stat = STATS[run]
            stat['requests'] += 1
            stat['active'] += 1
            stat['peak'] = max(stat['peak'], stat['active'])
        try:
            if parts[2] == 'slow':
                time.sleep(0.15)
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(path.stat().st_size))
            self.send_header('Cache-Control', 'private, max-age=3600')
            self.end_headers()
            with path.open('rb') as source:
                while chunk := source.read(8192):
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    with LOCK:
                        stat['bytes'] += len(chunk)
                    if parts[2] == 'slow':
                        time.sleep(len(chunk) / (256 * 1024))
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            with LOCK:
                stat['active'] -= 1


if __name__ == '__main__':
    print('Gallery test server: http://127.0.0.1:8765/tests/browser.html', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
