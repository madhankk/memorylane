"""Loopback-only HTTP API for the dedicated Apple Photos helper."""

import argparse
import hmac
import importlib
import importlib.util
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .catalog import load_catalog, map_photo, validate_library

logger = logging.getLogger(__name__)


def make_server(host: str, port: int, token: str, catalog_loader=load_catalog):
    if host not in {"127.0.0.1", "::1"}:
        raise ValueError("The Photos helper may listen only on loopback")
    if not token:
        raise ValueError("The Photos helper requires an installation token")

    class Handler(BaseHTTPRequestHandler):
        catalog_cache = {}

        def log_message(self, format, *args):
            pass

        def send_json(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            supplied = self.headers.get("X-MemoryLane-Token", "")
            if not hmac.compare_digest(supplied, token):
                self.send_json(401, {"error": "Unauthorized"})
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            if self.path != "/health":
                return self.send_json(404, {"error": "Not found"})
            if importlib.util.find_spec("osxphotos") is None:
                return self.send_json(503, {"error": "osxphotos is not installed; restart with npm run photos-helper"})
            self.send_json(200, {"status": "ready"})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != "/catalog":
                return self.send_json(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 16_384:
                    raise ValueError("Invalid request size")
                body = json.loads(self.rfile.read(length))
                library = validate_library(body["library_path"])
                cursor = body.get("cursor", 0)
                limit = body.get("limit", 200)
                if not isinstance(cursor, int) or cursor < 0 or not isinstance(limit, int) or not 1 <= limit <= 500:
                    raise ValueError("Invalid cursor or limit")
                key = str(library)
                if cursor == 0 or key not in self.catalog_cache:
                    self.catalog_cache[key] = catalog_loader(library)
                assets = self.catalog_cache[key]
                next_cursor = cursor + limit if cursor + limit < len(assets) else None
                page = assets[cursor:cursor + limit]
                mapped, failures = [], []
                for item in page:
                    try:
                        mapped.append(item if isinstance(item, dict) else map_photo(item))
                    except Exception as error:
                        try:
                            uuid = str(getattr(item, "uuid", "unknown"))
                        except Exception:
                            uuid = "unknown"
                        failures.append({"uuid": uuid, "error": str(error)})
                self.send_json(200, {"assets": mapped, "failures": failures,
                                     "next_cursor": next_cursor, "total": len(assets)})
                if next_cursor is None:
                    self.catalog_cache.pop(key, None)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                self.send_json(400, {"error": str(error)})
            except PermissionError:
                self.send_json(403, {"error": "Photos library access denied; grant Full Disk Access to the helper's terminal"})
            except ImportError:
                self.send_json(503, {"error": "osxphotos is not installed; restart with npm run photos-helper"})
            except Exception:
                logger.exception("Photos catalog request failed")
                self.send_json(503, {"error": "Photos catalogue could not be read; check helper logs and library version"})

    return ThreadingHTTPServer((host, port), Handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--port", type=int, default=4282)
    args = parser.parse_args()
    token = args.token_file.read_text(encoding="utf-8").strip()
    # osxphotos imports PhotoScript, which compiles AppleScript. macOS can block
    # that security check when it first runs in a request worker thread.
    # Initialize it on the main thread before the threaded server starts.
    print("Initializing Apple Photos catalog support…", flush=True)
    importlib.import_module("osxphotos")
    server = make_server("127.0.0.1", args.port, token)
    print(f"Apple Photos helper listening on http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
