import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path

from memorylane_photos.catalog import map_photo, validate_library
from memorylane_photos.server import make_server


class FakePhoto:
    uuid = "A-UUID"
    original_filename = "Vacation.JPG"
    path = None
    path_derivatives = ["/tmp/preview.jpeg"]
    date = None
    title = "Vacation"
    description = ""
    keywords = ["travel"]
    favorite = True
    hidden = False
    intrash = False
    latitude = 12.5
    longitude = -70.0
    face_info = []


class CatalogTests(unittest.TestCase):
    def test_mapping_keeps_one_preview_only_asset(self):
        row = map_photo(FakePhoto())
        self.assertEqual(row["uuid"], "A-UUID")
        self.assertEqual(row["original_filename"], "Vacation.JPG")
        self.assertIsNone(row["original_path"])
        self.assertEqual(row["derivative_path"], "/tmp/preview.jpeg")
        self.assertFalse(row["original_available"])
        self.assertEqual(row["keywords"], ["travel"])

    def test_rejects_non_package_and_accepts_readable_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = Path(tmp) / "Pictures.photoslibrary"
            library.mkdir()
            (library / "database").mkdir()
            (library / "database" / "Photos.sqlite").write_bytes(b"fixture")
            self.assertEqual(validate_library(str(library)), library.resolve())
            with self.assertRaises(ValueError):
                validate_library(str(Path(tmp) / "not-a-library"))

    def test_loopback_service_requires_token_and_caps_page_size(self):
        records = [{"uuid": str(i)} for i in range(3)]
        scratch = tempfile.TemporaryDirectory()
        library = Path(scratch.name) / "a.photoslibrary"
        library.mkdir()
        (library / "database").mkdir()
        (library / "database" / "Photos.sqlite").write_bytes(b"fixture")
        server = make_server("127.0.0.1", 0, "secret", lambda _: records)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            conn = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            conn.request("POST", "/catalog", json.dumps({"library_path": str(library), "cursor": 0, "limit": 2}), {"Content-Type": "application/json"})
            denied = conn.getresponse()
            self.assertEqual(denied.status, 401)
            denied.read()
            conn.request("POST", "/catalog", json.dumps({"library_path": str(library), "cursor": 0, "limit": 2}), {"Content-Type": "application/json", "X-MemoryLane-Token": "secret"})
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            body = json.loads(response.read())
            self.assertEqual(len(body["assets"]), 2)
            self.assertEqual(body["next_cursor"], 2)
        finally:
            conn.close()
            server.shutdown()
            server.server_close()
            thread.join()
            scratch.cleanup()


if __name__ == "__main__":
    unittest.main()
