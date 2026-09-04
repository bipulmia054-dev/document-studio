import base64, hashlib, hmac, io, json, mimetypes, os, re, secrets, sqlite3, zipfile
import urllib.error, urllib.request
import worker_system
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse, quote

ROOT = Path(__file__).resolve().parent
APP_DIR, DATA_DIR = ROOT / "app", ROOT / "data"
ARCHIVE_DIR, DB_PATH = DATA_DIR / "customers", DATA_DIR / "document_studio.db"
APP_DIR = ROOT / "dist" / "client"
PORT = int(os.environ.get("PORT", "8765"))
SESSION_DAYS = 30

def db():
    connection = sqlite3.connect(DB_PATH, timeout=20)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection

def initialize():
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA synchronous=NORMAL")
        con.execute("""CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL)""")
        con.execute("""CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, serial TEXT UNIQUE, name TEXT NOT NULL,
            name_bn TEXT DEFAULT '', customer_number TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
            archive_name TEXT NOT NULL, archive_path TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
            case_json TEXT DEFAULT '')""")
        columns = {row[1] for row in con.execute("PRAGMA table_info(customers)")}
        if "case_json" not in columns: con.execute("ALTER TABLE customers ADD COLUMN case_json TEXT DEFAULT ''")
        con.execute("""CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT NOT NULL,
            expires_at TEXT NOT NULL)""")
        con.execute("""CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_customers_number ON customers(customer_number)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)")
        worker_system.initialize(con, DATA_DIR)
        con.execute("PRAGMA optimize")

def digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310000).hex()

def safe(value):
    value = "".join("_" if c in '<>:"/\\|?*' else c for c in value.strip())
    return "_".join(value.split())[:80] or "CUSTOMER"

def archive_payload(data):
    archive = str(data.get("archive", ""))
    if archive.startswith("data:application/zip;base64,"):
        suffix = ".zip"
    elif archive.startswith("data:application/pdf;base64,"):
        suffix = ".pdf"  # Older clients can still save their existing PDF format.
    else:
        raise ValueError("Customer ZIP পাওয়া যায়নি")
    content = base64.b64decode(archive.split(",", 1)[1], validate=True)
    if len(content) > 80 * 1024 * 1024: raise ValueError("Archive 80 MB-এর বেশি")
    if suffix == ".zip":
        with zipfile.ZipFile(io.BytesIO(content)) as archive_file:
            entries = archive_file.infolist()
            if len(entries) > 250 or sum(item.file_size for item in entries) > 200 * 1024 * 1024:
                raise ValueError("ZIP file অতিরিক্ত বড়")
            roots = set()
            for item in entries:
                parts = item.filename.rstrip("/").split("/")
                if not parts or len(parts) > 2 or any(p in ("", ".", "..") for p in parts) or "\\" in item.filename or ":" in item.filename:
                    raise ValueError("ZIP folder structure সঠিক নয়")
                roots.add(parts[0])
                if not item.is_dir() and (len(parts) != 2 or Path(item.filename).suffix.lower() not in (".jpg",".jpeg",".png",".pdf",".txt")):
                    raise ValueError("ZIP-এ অসমর্থিত file রয়েছে")
            if len(roots) != 1: raise ValueError("ZIP-এর ভিতরে একটি customer folder রাখুন")
    return content, suffix

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def body(self, limit=75 * 1024 * 1024):
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= limit: raise ValueError("Request size সঠিক নয়")
        return json.loads(self.rfile.read(length))

    def token(self):
        cookies = SimpleCookie(self.headers.get("Cookie", ""))
        return cookies.get("ds_session").value if cookies.get("ds_session") else ""

    def current_user(self):
        token = self.token()
        if not token: return None
        now = datetime.now(timezone.utc).isoformat()
        with db() as con:
            con.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
            row = con.execute("""SELECT u.* FROM sessions s JOIN users u ON u.username=s.username
                WHERE s.token=?""", (token,)).fetchone()
        return row

    def user(self):
        row = self.current_user()
        return row["username"] if row else None

    def is_admin(self):
        row = self.current_user()
        return bool(row and row["role"] == "admin" and row["status"] == "approved")

    def authorized(self):
        current = self.current_user()
        if current and current["status"] == "approved": return True
        if current:
            self.reply(403, {"error": "Account বর্তমানে locked/suspended আছে"})
            return False
        self.reply(401, {"error": "আবার Login করুন"})
        return False

    def do_GET(self):
        route = urlparse(self.path)
        if route.path == "/api/auth/status":
            with db() as con: setup = con.execute("SELECT 1 FROM users LIMIT 1").fetchone() is None
            user = self.current_user()
            return self.reply(200, {"setupRequired": setup, "authenticated": bool(user),
                **(worker_system.public_user(user) if user else {})})
        if route.path.startswith(("/api/worker/", "/api/admin/")):
            handled = worker_system.dispatch(self, "GET", route.path, db, DATA_DIR, digest)
            if handled is not False: return handled
        if route.path == "/api/customers":
            if not self.authorized(): return
            query = parse_qs(route.query).get("q", [""])[0].strip(); pattern = f"%{query}%"
            current = self.current_user()
            with db() as con:
                rows = con.execute("""SELECT id,serial,name,name_bn,customer_number,phone,email,archive_name,created_at,created_by,workflow_status,correction_note
                    FROM customers WHERE (?='admin' OR created_by=?) AND (?='' OR serial LIKE ? OR name LIKE ? COLLATE NOCASE OR name_bn LIKE ?
                    OR customer_number LIKE ? OR phone LIKE ? OR email LIKE ? COLLATE NOCASE
                    OR json_extract(CASE WHEN json_valid(case_json) THEN case_json ELSE '{}' END,
                                    '$.people[0].nid') LIKE ?)
                    ORDER BY id DESC LIMIT 100""",
                    (current["role"], current["username"], query, pattern, pattern, pattern, pattern, pattern, pattern, pattern)).fetchall()
            if current["role"] != "admin":
                return self.reply(200, {"customers": [{"id": r["id"], "serial": r["serial"], "name": r["name"],
                    "name_bn": r["name_bn"], "customer_number": "••••" + r["customer_number"][-4:] if r["customer_number"] else "",
                    "phone": "••••••" + r["phone"][-4:] if r["phone"] else "", "email": "", "created_at": r["created_at"],
                    "workflow_status": r["workflow_status"], "correction_note": r["correction_note"]} for r in rows]})
            return self.reply(200, {"customers": [dict(row) for row in rows]})
        if route.path == "/api/settings/gemini":
            if not self.authorized(): return
            with db() as con: row = con.execute("SELECT value FROM settings WHERE key='gemini_api_key'").fetchone()
            return self.reply(200, {"configured": bool(row and row["value"]), "editable": self.is_admin()})
        if route.path.startswith("/api/customers/") and route.path.endswith("/download"):
            if not self.is_admin(): return self.reply(403, {"error": "শুধু Admin file download করতে পারবেন"})
            try: customer_id = int(route.path.split("/")[3])
            except (ValueError, IndexError): return self.reply(400, {"error": "Invalid customer"})
            with db() as con: row = con.execute("SELECT archive_name,archive_path,name,phone,case_json FROM customers WHERE id=?", (customer_id,)).fetchone()
            if not row: return self.reply(404, {"error": "Customer file পাওয়া যায়নি"})
            path = Path(row["archive_path"])
            if not path.is_file() or path.parent.resolve() != ARCHIVE_DIR.resolve():
                return self.reply(404, {"error": "Archive file পাওয়া যায়নি"})
            if path.suffix.lower() == ".zip":
                content, download_name = path.read_bytes(), row["archive_name"]
            elif path.suffix.lower() == ".pdf":
                from customer_archive import legacy_customer_zip
                try:
                    case = json.loads(row["case_json"] or "{}")
                    content = legacy_customer_zip(dict(row), case, path.read_bytes())
                    download_name = f"{safe(row['name'])}_{safe(row['phone'] or 'NO-MOBILE')}.zip"
                except Exception:
                    return self.reply(400, {"error": "পুরোনো customer Edit করে আবার Save করুন, তারপর ZIP download করুন"})
            else:
                # Legacy ZIP records are delivered as one PDF too; the original archive remains untouched.
                from PIL import Image
                from pypdf import PdfReader, PdfWriter
                writer = PdfWriter()
                with zipfile.ZipFile(path) as archive:
                    entries = [name for name in archive.namelist() if name.lower().endswith((".pdf", ".jpg", ".jpeg", ".png"))]
                    for entry in sorted(entries, key=lambda name: (not name.lower().endswith(".pdf"), name.lower())):
                        raw = archive.read(entry)
                        try:
                            if entry.lower().endswith(".pdf"):
                                reader = PdfReader(io.BytesIO(raw))
                            else:
                                picture = Image.open(io.BytesIO(raw)).convert("RGB")
                                page = io.BytesIO(); picture.save(page, format="PDF", resolution=150.0); page.seek(0)
                                reader = PdfReader(page)
                            for pdf_page in reader.pages: writer.add_page(pdf_page)
                        except Exception: continue
                if not writer.pages: return self.reply(400, {"error": "পুরোনো file PDF-এ convert করা যায়নি"})
                merged = io.BytesIO(); writer.write(merged); content = merged.getvalue()
                download_name = f"{safe(row['name'])}_{safe(row['phone'] or 'NO-MOBILE')}.pdf"
            ascii_name = download_name.encode("ascii", "ignore").decode() or "CUSTOMER_DOCUMENT.pdf"
            self.send_response(200)
            self.send_header("Content-Type", "application/zip" if download_name.lower().endswith(".zip") else "application/pdf")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Disposition", f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(download_name)}")
            self.send_header("Content-Length", str(len(content))); self.end_headers(); self.wfile.write(content); return
        if route.path.startswith("/api/customers/") and route.path.endswith("/edit"):
            if not self.is_admin(): return self.reply(403, {"error": "Submit করার পর Worker file দেখতে বা edit করতে পারবেন না"})
            try: customer_id = int(route.path.split("/")[3])
            except (ValueError, IndexError): return self.reply(400, {"error": "Invalid customer"})
            with db() as con: row = con.execute("SELECT archive_path,case_json FROM customers WHERE id=?", (customer_id,)).fetchone()
            if not row: return self.reply(404, {"error": "Customer পাওয়া যায়নি"})
            if row["case_json"]:
                try: return self.reply(200, {"case": json.loads(row["case_json"]), "customerId": customer_id})
                except Exception: pass
            path = Path(row["archive_path"])
            if not path.is_file() or path.parent.resolve() != ARCHIVE_DIR.resolve(): return self.reply(404, {"error": "Archive পাওয়া যায়নি"})
            try:
                with zipfile.ZipFile(path) as archive:
                    entry = next((name for name in archive.namelist() if name.endswith("Case_Data.json")), None)
                    if not entry: raise ValueError("পুরোনো file-এ editable case data নেই; Details Edit ব্যবহার করুন")
                    case = json.loads(archive.read(entry).decode("utf-8"))
                return self.reply(200, {"case": case, "customerId": customer_id})
            except Exception as error: return self.reply(400, {"error": str(error)})
        if route.path.startswith("/api/"):
            return self.reply(404, {"error": "API route পাওয়া যায়নি; server update/restart করুন"})
        super().do_GET()

    def do_POST(self):
        route = urlparse(self.path).path
        if route == "/api/auth/setup": return self.auth_setup()
        if route == "/api/auth/login": return self.login()
        if route == "/api/auth/logout":
            with db() as con: con.execute("DELETE FROM sessions WHERE token=?", (self.token(),))
            return self.reply(200, {"ok": True}, clear=True)
        if route.startswith(("/api/worker/", "/api/admin/")):
            handled = worker_system.dispatch(self, "POST", route, db, DATA_DIR, digest)
            if handled is not False: return handled
        if route == "/api/settings/gemini":
            if self.is_admin(): return self.save_gemini_key()
            return self.reply(403, {"error": "শুধু Admin API key পরিবর্তন করতে পারবেন"})
            return
        if route == "/api/customers": return self.save_customer()
        if route == "/api/gemini-scan":
            if self.authorized(): return self.gemini_scan()
            return
        if route == "/api/gemini-description":
            if self.authorized(): return self.gemini_description()
            return
        if route == "/api/card-scan":
            if self.authorized(): return self.card_scan()
            return
        if route == "/api/passport-photo":
            if self.authorized(): return self.passport_photo()
            return
        if route == "/api/signature-scan":
            if self.authorized(): return self.signature_scan()
            return
        if route.startswith("/api/"):
            return self.reply(404, {"error": "API route পাওয়া যায়নি; server update/restart করুন"})
        self.send_error(404)

    def signature_scan(self):
        try:
            import cv2
            import numpy as np
            data = self.body(20 * 1024 * 1024)
            encoded = str(data.get("image", ""))
            if "," in encoded: encoded = encoded.split(",", 1)[1]
            source = cv2.imdecode(np.frombuffer(base64.b64decode(encoded), np.uint8), cv2.IMREAD_COLOR)
            if source is None: raise ValueError("Signature image পড়া যায়নি")
            scale = min(1.0, 1600 / max(source.shape[:2]))
            if scale < 1:
                source = cv2.resize(source, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
            background = cv2.GaussianBlur(gray, (0, 0), max(15, min(source.shape[:2]) / 22))
            darkness = cv2.subtract(background, gray)
            saturation = cv2.cvtColor(source, cv2.COLOR_BGR2HSV)[:, :, 1]
            strength = np.maximum(darkness.astype(np.float32) * 5.2,
                                  np.maximum(0, saturation.astype(np.float32) - 35) * 1.65)
            alpha = np.clip((strength - 12) * 2.8, 0, 255).astype(np.uint8)
            alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
            alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
            binary = (alpha > 28).astype(np.uint8) * 255
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            boxes = [cv2.boundingRect(c) for c in contours if cv2.contourArea(c) >= 3]
            if not boxes: raise ValueError("স্বাক্ষর detect হয়নি—সাদা কাগজে গাঢ় কলমে স্বাক্ষর করুন")
            x1 = min(x for x, y, w, h in boxes); y1 = min(y for x, y, w, h in boxes)
            x2 = max(x + w for x, y, w, h in boxes); y2 = max(y + h for x, y, w, h in boxes)
            height, width = source.shape[:2]
            pad = max(8, int(min(width, height) * .025))
            x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
            x2, y2 = min(width, x2 + pad), min(height, y2 + pad)
            coverage = ((x2 - x1) * (y2 - y1)) / max(1, width * height)
            confidence = int(max(15, min(99, 45 + coverage * 180)))
            points = [{"x": x1 / width, "y": y1 / height}, {"x": x2 / width, "y": y1 / height},
                      {"x": x2 / width, "y": y2 / height}, {"x": x1 / width, "y": y2 / height}]
            if str(data.get("action", "process")) == "detect":
                return self.reply(200, {"points": points, "confidence": confidence})
            rgba = cv2.cvtColor(source, cv2.COLOR_BGR2BGRA)
            # Preserve blue/black ink colour while removing the paper completely.
            rgb = rgba[:, :, :3].astype(np.float32)
            rgb = np.clip((rgb - 128) * 1.12 + 128, 0, 255).astype(np.uint8)
            rgba[:, :, :3] = rgb; rgba[:, :, 3] = alpha
            cropped = rgba[y1:y2, x1:x2]
            if cropped.size == 0: raise ValueError("Signature crop তৈরি হয়নি")
            ok, buffer = cv2.imencode(".png", cropped, [cv2.IMWRITE_PNG_COMPRESSION, 7])
            if not ok: raise ValueError("Signature PNG তৈরি হয়নি")
            return self.reply(200, {"image": "data:image/png;base64," + base64.b64encode(buffer).decode("ascii"),
                                    "points": points, "confidence": confidence})
        except Exception as error:
            return self.reply(400, {"error": str(error)})

    def passport_photo(self):
        try:
            import cv2
            import numpy as np
            data = self.body(25 * 1024 * 1024)
            encoded = str(data.get("image", ""))
            if "," in encoded: encoded = encoded.split(",", 1)[1]
            raw_source = base64.b64decode(encoded)
            source = cv2.imdecode(np.frombuffer(raw_source, np.uint8), cv2.IMREAD_COLOR)
            if source is None: raise ValueError("Photo পড়া যায়নি")
            max_side = 1800
            if max(source.shape[:2]) > max_side:
                scale = max_side / max(source.shape[:2])
                source = cv2.resize(source, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            face_detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
            def find_face(image):
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                faces = face_detector.detectMultiScale(gray, 1.12, 5, minSize=(70, 70))
                return (max(faces, key=lambda f: f[2] * f[3]), gray) if len(faces) else (None, gray)
            face, gray = find_face(source)
            if face is None: raise ValueError("Face পাওয়া যায়নি—সামনে তাকিয়ে পরিষ্কার ছবি তুলুন")
            with db() as con: key_row = con.execute("SELECT value FROM settings WHERE key='gemini_api_key'").fetchone()
            api_key = str(data.get("apiKey", "")).strip() or (key_row["value"] if key_row else "")
            if not api_key: raise ValueError("Settings-এ Gemini API key দিন")

            # Shared by Applicant and Nominee through /api/passport-photo.
            prompt = """Create a professional passport-size studio portrait from the uploaded photo. Keep the person's face exactly the same and preserve identity, facial structure, skin tone, hairline, beard, and natural features.

Make the image look like a high-quality official ID/passport photo. Center the face perfectly in the frame, straight front-facing pose, symmetrical composition, head and shoulders visible. Symmetry applies to framing only: preserve the person's natural facial asymmetry.

Change the background to a clean solid blue passport photo background. Use soft professional studio lighting. Improve image clarity and sharpness and remove blur and noise. Retouch facial skin to look smooth, clear and clean: remove visible facial spots, dark spots, acne blemishes and skin marks, and even out patchy skin texture and uneven shadows. Slightly brighten the face while preserving the person's original skin tone; do not whiten or change skin color. Keep subtle natural skin texture and realistic detail rather than a waxy, plastic, airbrushed or blurred surface. This skin cleanup is explicitly allowed, but must not change facial geometry, eyes, eyebrows, nose, lips, hairline, beard or the original expression.

Keep the same clothes as in the uploaded photo, including their original garment type, color, pattern and recognizable design. Restyle their presentation into a neat, smart, formal passport-photo appearance: straighten the collar or neckline where present, tidy folds and draping, remove distracting wrinkles, and make the clothing sit cleanly and naturally on the shoulders. If the person wears a dark navy shirt, keep that exact dark navy shirt; do not replace the outfit with an invented suit, tie or different dress.

Improve the upper-body silhouette through natural upright posture and tidy clothing rather than copying a slouched or awkward source pose. Keep the torso front-facing, shoulders relaxed and level, neck alignment natural, and head-and-shoulders framing balanced. Preserve believable anatomy and the person's natural build; do not create exaggerated slimming, muscularity, stretched shoulders or a disproportionate neck. The face must not change when correcting the pose.

Groom the existing hair into a smart, neat studio appearance: smooth stray flyaway hairs, tidy the parting and shape, and arrange the same hair naturally. Preserve its original color, length, texture, natural hairline and recognizable style; do not invent hair over bald areas or alter the forehead. If a head covering is present, keep it on and tidy its existing folds without exposing or inventing hidden hair.

Preserve the person's natural facial expression from the uploaded photo. Do not add a smile, happy expression or other expression change. Keep the original mouth shape, eyes and facial geometry unchanged.

Make the person look neat, confident, and professional with a smart upright, front-facing pose, relaxed level shoulders and a naturally aligned head. No artificial facial beauty changes, no face reshaping, no changing facial features. Smartness should come from grooming, posture, clothing presentation and lighting only.

Final output:
- One passport-size photo, vertical 7:9 composition
- Clean solid blue background, no border or text
- Face centered, head and shoulders visible
- Natural skin tone
- High resolution and sharp detail
- Professional studio quality
- Realistic appearance
Identity preservation takes priority over beautification or pose correction."""
            payload = json.dumps({
                "contents": [{"parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(raw_source).decode("ascii")}}
                ]}],
                "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
            }).encode("utf-8")
            url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent"
            request = urllib.request.Request(url, data=payload, method="POST", headers={
                "Content-Type": "application/json", "x-goog-api-key": api_key
            })
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    ai_response = json.loads(response.read())
            except urllib.error.HTTPError as error:
                try: detail = json.loads(error.read()).get("error", {}).get("message", "")
                except Exception: detail = ""
                raise ValueError(detail or f"Gemini image remake HTTP {error.code}")
            parts = (((ai_response.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
            image_part = next((part.get("inlineData") or part.get("inline_data") for part in parts
                               if part.get("inlineData") or part.get("inline_data")), None)
            if not image_part or not image_part.get("data"):
                raise ValueError("Gemini passport portrait ফেরত দেয়নি")
            generated = cv2.imdecode(np.frombuffer(base64.b64decode(image_part["data"]), np.uint8), cv2.IMREAD_COLOR)
            if generated is None: raise ValueError("Gemini portrait পড়া যায়নি")
            generated = cv2.resize(generated, (700, 900), interpolation=cv2.INTER_LANCZOS4)

            if find_face(generated)[0] is None:
                raise ValueError("Remade portrait-এ face detect হয়নি—অন্য ছবি দিয়ে চেষ্টা করুন")
            # A small deterministic exposure lift; this changes lighting only, not facial geometry.
            lab = cv2.cvtColor(generated, cv2.COLOR_BGR2LAB)
            light, color_a, color_b = cv2.split(lab)
            light = cv2.createCLAHE(clipLimit=1.18, tileGridSize=(8, 8)).apply(light)
            result = cv2.cvtColor(cv2.merge((light, color_a, color_b)), cv2.COLOR_LAB2BGR)
            result = cv2.convertScaleAbs(result, alpha=1.02, beta=5)
            output = None
            for quality in (94, 90, 86, 82, 78, 74, 70, 65, 60):
                ok, buffer = cv2.imencode(".jpg", result, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if ok:
                    output = buffer.tobytes()
                    if len(output) <= 150 * 1024: break
            if not output: raise ValueError("Passport photo তৈরি হয়নি")
            return self.reply(200, {"image": "data:image/jpeg;base64," + base64.b64encode(output).decode("ascii"),
                                    "faceChanged": True, "faceLocked": False, "aiRemake": True,
                                    "warning": "সম্পূর্ণ portrait AI remake হয়েছে—Confirm করার আগে পরিচয় ও মুখ মিলিয়ে দেখুন"})
        except Exception as error:
            return self.reply(400, {"error": str(error)})

    def card_scan(self):
        try:
            import cv2
            import numpy as np
            data = self.body(30 * 1024 * 1024)
            encoded = str(data.get("image", ""))
            if "," in encoded: encoded = encoded.split(",", 1)[1]
            raw = base64.b64decode(encoded)
            source = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            if source is None: raise ValueError("ID card image পড়া যায়নি")
            height, width = source.shape[:2]
            action = data.get("action", "detect")
            fixed_ratio = bool(data.get("fixedRatio", False))
            if action == "detect":
                scale = min(1.0, 900 / max(width, height))
                small = cv2.resize(source, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                raw_gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                enhanced = cv2.createCLAHE(2.2, (8, 8)).apply(raw_gray)
                candidates = []
                frame_area = small.shape[0] * small.shape[1]
                for gray in (raw_gray, enhanced):
                    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
                    masks = [cv2.Canny(blurred, 30, 100), cv2.Canny(blurred, 55, 170),
                             cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)]
                    for mask in masks:
                        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
                        # RETR_LIST is essential: the ID is normally an inner rectangle inside the camera frame.
                        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
                        for contour in contours:
                            area = cv2.contourArea(contour)
                            area_fraction = area / frame_area
                            if area_fraction < (.065 if fixed_ratio else .035) or area_fraction > (.72 if fixed_ratio else .88): continue
                            bx, by, bw, bh = cv2.boundingRect(contour)
                            # Never accept the camera/photo frame itself as the document.
                            margin_x = small.shape[1] * (.035 if fixed_ratio else .018)
                            margin_y = small.shape[0] * (.035 if fixed_ratio else .018)
                            if bx <= margin_x or by <= margin_y or bx + bw >= small.shape[1] - margin_x or by + bh >= small.shape[0] - margin_y:
                                continue
                            perimeter = cv2.arcLength(contour, True)
                            approx = cv2.approxPolyDP(contour, .02 * perimeter, True)
                            if len(approx) == 4 and cv2.isContourConvex(approx):
                                quad = approx.reshape(4, 2).astype("float32")
                            else:
                                # For ID cards do not invent four corners from arbitrary inner shapes/text.
                                if fixed_ratio: continue
                                rect_guess = cv2.minAreaRect(contour)
                                rw_guess, rh_guess = rect_guess[1]
                                rectangle_area = max(1, rw_guess * rh_guess)
                                if area / rectangle_area < .62: continue
                                quad = cv2.boxPoints(rect_guess).astype("float32")
                            rect = cv2.minAreaRect(quad); rw, rh = rect[1]
                            rectangle_area = max(1, rw * rh)
                            rectangularity = min(1.0, area / rectangle_area)
                            ratio = max(rw, rh) / max(1, min(rw, rh))
                            if fixed_ratio:
                                if not 1.30 <= ratio <= 1.88 or rectangularity < .72: continue
                                ratio_score = max(0, 1 - abs(ratio - 1.586) / .34)
                                if ratio_score < .35: continue
                            else: ratio_score = max(.45, 1 - abs(ratio - 1.45) / 2.2)
                            cx, cy = bx + bw / 2, by + bh / 2
                            center_distance = np.hypot(cx / small.shape[1] - .5, cy / small.shape[0] - .5)
                            center_score = max(.35, 1 - center_distance)
                            # Ratio dominates area so a large outer photo cannot beat the inner ID card.
                            # Prefer a clearly internal, medium-to-large card rather than the outer photo border.
                            size_score = min(1.0, area_fraction / .28)
                            if fixed_ratio and area_fraction > .58: size_score *= max(.25, 1 - (area_fraction - .58) * 4)
                            score = size_score * (ratio_score ** 3 if fixed_ratio else ratio_score) * (rectangularity ** 2) * center_score
                            candidates.append((score, area_fraction, ratio_score, quad))
                points, confidence = None, 0
                if candidates:
                    score, area_fraction, ratio_score, points = max(candidates, key=lambda item: item[0])
                    confidence = min(99, round(35 + 32 * ratio_score + 24 * min(1, area_fraction / .35) + 18 * min(1, score)))
                if points is None: raise ValueError("ছবির ভিতরে ID card-এর চারটি corner পাওয়া যায়নি")
                sums, diffs = points.sum(axis=1), np.diff(points, axis=1).reshape(-1)
                ordered = np.array([points[np.argmin(sums)], points[np.argmin(diffs)], points[np.argmax(sums)], points[np.argmax(diffs)]])
                result = [{"x": round(float(x / small.shape[1]), 5), "y": round(float(y / small.shape[0]), 5)} for x, y in ordered]
                return self.reply(200, {"points": result, "confidence": confidence})
            points = data.get("points", [])
            if len(points) != 4: raise ValueError("চারটি corner পাওয়া যায়নি")
            src_points = np.float32([[float(p["x"]) * width, float(p["y"]) * height] for p in points])
            out_width = 1200
            if fixed_ratio: out_height = round(out_width / 1.586)
            else:
                top = np.linalg.norm(src_points[1] - src_points[0]); bottom = np.linalg.norm(src_points[2] - src_points[3])
                left = np.linalg.norm(src_points[3] - src_points[0]); right = np.linalg.norm(src_points[2] - src_points[1])
                ratio = max(.55, min(1.55, max(left, right) / max(1, max(top, bottom))))
                out_height = round(out_width * ratio)
            dst_points = np.float32([[0, 0], [out_width - 1, 0], [out_width - 1, out_height - 1], [0, out_height - 1]])
            matrix = cv2.getPerspectiveTransform(src_points, dst_points)
            result = cv2.warpPerspective(source, matrix, (out_width, out_height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            mode = str(data.get("mode", "auto"))
            if mode == "auto":
                lab = cv2.cvtColor(result, cv2.COLOR_BGR2LAB); l, a, b = cv2.split(lab)
                l = cv2.createCLAHE(2.0, (8, 8)).apply(l)
                result = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
            elif mode == "lighten": result = cv2.convertScaleAbs(result, alpha=1.06, beta=24)
            elif mode == "magic":
                hsv = cv2.cvtColor(result, cv2.COLOR_BGR2HSV).astype(np.float32)
                hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.35, 0, 255); hsv[:, :, 2] = np.clip(hsv[:, :, 2] * 1.08, 0, 255)
                result = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
            elif mode == "gray": result = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
            elif mode == "bw":
                gray = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
                result = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 12)
            output = None
            for quality in (92, 86, 80, 74, 68, 62, 56, 50, 44, 38):
                ok, buffer = cv2.imencode(".jpg", result, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if ok:
                    output = buffer.tobytes()
                    if len(output) <= 150 * 1024: break
            if not output: raise ValueError("ID card JPG তৈরি হয়নি")
            return self.reply(200, {"image": "data:image/jpeg;base64," + base64.b64encode(output).decode("ascii")})
        except Exception as error:
            return self.reply(400, {"error": str(error)})

    def do_PATCH(self):
        route = urlparse(self.path).path
        if not route.startswith("/api/customers/") or not self.is_admin(): return self.reply(403, {"error": "শুধু Admin edit করতে পারবেন"})
        try:
            customer_id = int(route.split("/")[3]); data = self.body(1024 * 1024)
            values = tuple(str(data.get(key, "")).strip() for key in ("name", "nameBn", "customerNumber", "phone", "email"))
            if not values[0]: raise ValueError("Customer name খালি রাখা যাবে না")
            with db() as con:
                result = con.execute("""UPDATE customers SET name=?,name_bn=?,customer_number=?,phone=?,email=?
                    WHERE id=?""", (*values, customer_id))
            if not result.rowcount: return self.reply(404, {"error": "Customer পাওয়া যায়নি"})
            return self.reply(200, {"ok": True})
        except Exception as error: return self.reply(400, {"error": str(error)})

    def do_DELETE(self):
        route = urlparse(self.path).path
        if not route.startswith("/api/customers/") or not self.is_admin(): return self.reply(403, {"error": "শুধু Admin delete করতে পারবেন"})
        try:
            customer_id = int(route.split("/")[3])
            with db() as con:
                row = con.execute("SELECT archive_path FROM customers WHERE id=?", (customer_id,)).fetchone()
                if not row: return self.reply(404, {"error": "Customer পাওয়া যায়নি"})
                path = Path(row["archive_path"])
                if path.is_file() and path.parent.resolve() == ARCHIVE_DIR.resolve(): path.unlink()
                con.execute("DELETE FROM customers WHERE id=?", (customer_id,))
            return self.reply(200, {"ok": True})
        except Exception as error: return self.reply(400, {"error": str(error)})

    def do_PUT(self):
        route = urlparse(self.path).path
        if route.startswith(("/api/worker/", "/api/admin/")):
            handled = worker_system.dispatch(self, "PUT", route, db, DATA_DIR, digest)
            if handled is not False: return handled
        if not route.startswith("/api/customers/") or not self.is_admin(): return self.reply(403, {"error": "শুধু Admin edit করতে পারবেন"})
        try: customer_id = int(route.split("/")[3])
        except (ValueError, IndexError): return self.reply(400, {"error": "Invalid customer"})
        return self.update_customer(customer_id)

    def gemini_scan(self):
        try:
            data = self.body(25 * 1024 * 1024)
            api_key = str(data.get("apiKey", "")).strip()
            if not api_key:
                with db() as con: row = con.execute("SELECT value FROM settings WHERE key='gemini_api_key'").fetchone()
                api_key = row["value"] if row else ""
            images = data.get("images", [])
            if not api_key or not isinstance(images, list) or not images:
                raise ValueError("Gemini API key বা ID image পাওয়া যায়নি")
            parts = [{"text": """Read these front and back images of one Bangladesh ID card. Return only verified details visible on the card. Copy the card holder's Bangla father and mother names into fatherNameBn and motherNameBn when visible. Put their exact English/transliterated uppercase versions into fatherNameEn and motherNameEn. Never guess an unreadable name. Copy names exactly; keep internal spaces and uppercase all English names. NID must be digits only.
Address rules are strict:
1. addressBn must be exactly two lines and contain VALUES ONLY. Never write labels such as গ্রাম, ডাকঘর, পোস্ট কোড, থানা, উপজেলা, জেলা, Village, Post, Thana, Upazila or District.
2. addressBn line 1: village/road name, post-office name, postcode. Separate available values with comma and one space.
3. addressBn line 2: thana/upazila name, district name. If thana/upazila is not available, use the district name in both positions.
4. addressEn must translate/transliterate exactly those same values in exactly two UPPERCASE lines, also without any labels.
5. Preserve the postcode as digits. Never include parents' names in the address and never guess unreadable values."""}]
            for image in images[:2]:
                image = str(image)
                if not image.startswith("data:image/") or "," not in image:
                    continue
                header, encoded = image.split(",", 1)
                mime_type = header.split(";", 1)[0].split(":", 1)[1]
                parts.append({"inline_data": {"mime_type": mime_type, "data": encoded}})
            if len(parts) == 1:
                raise ValueError("সঠিক ID image পাওয়া যায়নি")
            properties = {key: {"type": "string"} for key in ("name", "nameBn", "fatherNameBn", "motherNameBn", "fatherNameEn", "motherNameEn", "nid", "dob", "addressBn", "addressEn", "text")}
            payload = json.dumps({"contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"temperature": 0, "responseMimeType": "application/json",
                    "responseJsonSchema": {"type": "object", "properties": properties,
                        "required": list(properties.keys())}}}).encode()
            url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" + api_key
            request = urllib.request.Request(url, data=payload,
                headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read())
            parts_out = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            content = "".join(str(part.get("text", "")) for part in parts_out).strip()
            start, end = content.find("{"), content.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("Gemini ID details ফেরত দেয়নি")
            parsed = json.loads(content[start:end + 1])
            clean = {key: str(parsed.get(key, "") or "").strip() for key in properties}
            clean["name"] = clean["name"].upper()
            clean["fatherNameEn"] = clean["fatherNameEn"].upper()
            clean["motherNameEn"] = clean["motherNameEn"].upper()
            clean["nid"] = "".join(char for char in clean["nid"] if char.isdigit())
            clean["addressEn"] = clean["addressEn"].upper()
            if not any((clean["name"], clean["nameBn"], clean["nid"])):
                raise ValueError("Gemini ছবিতে ID details খুঁজে পায়নি")
            return self.reply(200, clean)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read())
                message = body.get("error", {}).get("message", str(error))
            except Exception:
                message = str(error)
            return self.reply(error.code, {"error": message})
        except Exception as error:
            return self.reply(500, {"error": str(error)})

    def gemini_description(self):
        try:
            data = self.body(1024 * 1024)
            api_key = str(data.get("apiKey", "")).strip()
            if not api_key:
                with db() as con: row = con.execute("SELECT value FROM settings WHERE key='gemini_api_key'").fetchone()
                api_key = row["value"] if row else ""
            raw_text = str(data.get("text", "")).strip()
            person_name = str(data.get("name", "")).strip()
            profession = str(data.get("profession", "")).strip()
            monthly_income = str(data.get("monthlyIncome", "")).strip()
            if not api_key or not raw_text:
                raise ValueError("Gemini API key বা Description পাওয়া যায়নি")
            prompt = """নিচের তথ্য থেকে বাংলাদেশের ব্যাংক হিসাবের আয়ের উৎস ঘোষণাপত্রের জন্য প্রথম পুরুষে সহজ, স্বাভাবিক ও শুদ্ধ বাংলায় একটি গোছানো অনুচ্ছেদ লিখুন। আবেদনকারী নিজে কথা বলছেন—তাই 'আমার নাম...', 'আমি...', 'আমার মাসিক আয়...' ব্যবহার করুন। ৪-৬টি সহজ বাক্যে নাম, চাকরি/ব্যবসা/পেশা, কর্মস্থল বা ব্যবসার ধরন, মাসিক আয় এবং সেই আয় দিয়ে নিজের ব্যাংক হিসাব পরিচালনার কথা পরিষ্কারভাবে সাজান। সংক্ষিপ্ত লেখা ভেঙে পূর্ণ বাক্য করুন, কিন্তু কোনো নতুন প্রতিষ্ঠান, পদ, অঙ্ক, ঠিকানা বা দাবি বানাবেন না। Job/চাকরি হলে 'চাকরিজীবী', business হলে 'ব্যবসায়ী'—শুধু দেওয়া তথ্য অনুযায়ী লিখবেন। নাম বা আয়ের অঙ্ক আলাদা করে দেওয়া থাকলে ঠিক সেটিই ব্যবহার করবেন। শুধু চূড়ান্ত বাংলা অনুচ্ছেদ ফেরত দিন, শিরোনাম/ব্যাখ্যা নয়।

আবেদনকারীর নাম: """ + (person_name or "উল্লেখ নেই") + """
পেশা: """ + (profession or "মূল বক্তব্য অনুযায়ী") + """
মাসিক আয়: """ + (monthly_income or "মূল বক্তব্য অনুযায়ী") + """
Worker-এর মূল বক্তব্য:
""" + raw_text[:5000]
            payload = json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.25, "maxOutputTokens": 700}}).encode()
            url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" + api_key
            request = urllib.request.Request(url, data=payload,
                headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read())
            parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            text = "".join(str(part.get("text", "")) for part in parts).strip()
            if not text: raise ValueError("Gemini Description সাজাতে পারেনি")
            return self.reply(200, {"text": text})
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read())
                message = body.get("error", {}).get("message", str(error))
            except Exception:
                message = str(error)
            return self.reply(error.code, {"error": message})
        except Exception as error:
            return self.reply(500, {"error": str(error)})

    def process_text(self):
        try:
            data = self.body(2 * 1024 * 1024)
            api_key = str(data.get("apiKey", "")).strip()
            raw_text = str(data.get("text", "")).strip()
            if not api_key or not raw_text:
                raise ValueError("DeepSeek API key বা OCR text পাওয়া যায়নি")
            prompt = """The following text was extracted by OCR from a Bangladesh ID card. Correct obvious OCR errors using only visible evidence and return exactly these 9 labelled lines. Never guess missing values and never include parents' names in addresses.
NAME_EN: exact English name with original internal spaces, uppercase
NAME_BN: exact Bangla name
NID: digits only
DOB: date of birth
ADDRESS_BN_1: গ্রাম/রোড and ডাকঘর
ADDRESS_BN_2: থানা and জেলা
ADDRESS_EN_1: uppercase English translation/transliteration of line 1
ADDRESS_EN_2: uppercase English translation/transliteration of line 2
TEXT: concise cleaned OCR text

OCR TEXT:
""" + raw_text[:12000]
            payload = json.dumps({"model": "deepseek-v4-flash", "temperature": 0,
                "max_tokens": 1200, "messages": [{"role": "user", "content": prompt}]}).encode()
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json"}
            request = urllib.request.Request("https://api.deepseek.com/chat/completions", data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read())
            message = result.get("choices", [{}])[0].get("message", {})
            content = str(message.get("content") or message.get("reasoning_content") or "")
            labels = {}
            expected = {"NAME_EN", "NAME_BN", "NID", "DOB", "ADDRESS_BN_1", "ADDRESS_BN_2", "ADDRESS_EN_1", "ADDRESS_EN_2", "TEXT"}
            for line in content.splitlines():
                label, separator, value = line.strip().partition(":")
                label = label.strip().upper().replace(" ", "_")
                if separator and label in expected:
                    labels[label] = value.strip()
            json_result = {}
            start, end = content.find("{"), content.rfind("}")
            if start >= 0 and end > start:
                try:
                    candidate = json.loads(content[start:end + 1])
                    if isinstance(candidate, dict): json_result = candidate
                except json.JSONDecodeError:
                    pass
            def value(*keys):
                for key in keys:
                    if json_result.get(key) is not None: return str(json_result[key]).strip()
                return ""
            fallback_nid = (re.search(r"(?<!\d)(\d[\d\s-]{8,20}\d)(?!\d)", raw_text) or [None, ""])[1]
            fallback_dob = (re.search(r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b", raw_text) or [None, ""])[1]
            fallback_name = (re.search(r"(?im)^\s*(?:name)\s*[:：-]\s*([A-Za-z][A-Za-z .'-]{2,})$", raw_text) or [None, ""])[1]
            fallback_name_bn = (re.search(r"(?im)^\s*(?:নাম)\s*[:ঃ-]\s*([\u0980-\u09ff][\u0980-\u09ff .'-]{2,})$", raw_text) or [None, ""])[1]
            address_bn = value("addressBn", "address_bn") or "\n".join(filter(None, (labels.get("ADDRESS_BN_1"), labels.get("ADDRESS_BN_2"))))
            address_en = value("addressEn", "address_en") or "\n".join(filter(None, (labels.get("ADDRESS_EN_1"), labels.get("ADDRESS_EN_2"))))
            clean = {"name": (value("name", "nameEn", "name_en") or labels.get("NAME_EN", "") or fallback_name).upper(),
                "nameBn": value("nameBn", "name_bn", "banglaName") or labels.get("NAME_BN", "") or fallback_name_bn,
                "nid": "".join(c for c in (value("nid", "id", "idNumber") or labels.get("NID", "") or fallback_nid) if c.isdigit()),
                "dob": value("dob", "dateOfBirth") or labels.get("DOB", "") or fallback_dob,
                "addressBn": address_bn, "addressEn": address_en.upper(),
                "text": value("text", "rawText") or labels.get("TEXT", "") or raw_text}
            return self.reply(200, clean)
        except urllib.error.HTTPError as error:
            try: message = json.loads(error.read()).get("error", {}).get("message", str(error))
            except Exception: message = str(error)
            return self.reply(error.code, {"error": message})
        except Exception as error:
            return self.reply(500, {"error": str(error)})

    def auth_setup(self):
        try:
            data = self.body(4096); username = str(data.get("username", "")).strip(); password = str(data.get("password", ""))
            if len(username) < 3 or len(password) < 6: raise ValueError("Username কমপক্ষে ৩ এবং password ৬ অক্ষরের দিন")
            with db() as con:
                if con.execute("SELECT 1 FROM users LIMIT 1").fetchone(): return self.reply(409, {"error": "Account আগে থেকেই তৈরি আছে"})
                salt = secrets.token_hex(16)
                con.execute("INSERT INTO users(username,password_hash,salt,created_at,role,status,full_name,approved_at) VALUES(?,?,?,?, 'admin','approved',?,?)",
                    (username, digest(password, salt), salt, datetime.now(timezone.utc).isoformat(), username, datetime.now(timezone.utc).isoformat()))
            return self.session(username)
        except Exception as error: return self.reply(400, {"error": str(error)})

    def save_gemini_key(self):
        try:
            data = self.body(16384); api_key = str(data.get("apiKey", "")).strip()
            with db() as con:
                if api_key:
                    con.execute("INSERT INTO settings(key,value) VALUES('gemini_api_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (api_key,))
                else: con.execute("DELETE FROM settings WHERE key='gemini_api_key'")
            return self.reply(200, {"configured": bool(api_key)})
        except Exception as error: return self.reply(400, {"error": str(error)})

    def login(self):
        try:
            data = self.body(4096); username = str(data.get("username", "")).strip(); password = str(data.get("password", ""))
            with db() as con: user = con.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
            if not user or not hmac.compare_digest(user["password_hash"], digest(password, user["salt"])):
                return self.reply(401, {"error": "Username অথবা password সঠিক নয়"})
            if user["status"] != "approved":
                messages = {"pending": "আপনার account এখনো Admin approve করেননি", "rejected": "আপনার registration বাতিল হয়েছে", "suspended": "আপনার account সাময়িকভাবে বন্ধ আছে"}
                return self.reply(403, {"error": messages.get(user["status"], "Account active নয়"), "status": user["status"]})
            return self.session(user["username"])
        except Exception as error: return self.reply(400, {"error": str(error)})

    def session(self, username):
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat()
        with db() as con:
            con.execute("INSERT INTO sessions(token,username,expires_at) VALUES(?,?,?)", (token, username, expires))
        with db() as con: user = con.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        return self.reply(200, {"authenticated": True, **worker_system.public_user(user)}, cookie=token)

    def save_customer(self):
        if not self.authorized(): return
        try:
            data = self.body(); name = str(data.get("name", "")).strip().upper(); archive = str(data.get("archive", ""))
            if not name: raise ValueError("Customer name দিন")
            content, suffix = archive_payload(data)
            case_data = data.get("case") or {}
            applicant = (case_data.get("people") or [{}])[0]
            nid = worker_system.digits(applicant.get("nid") or data.get("customerNumber"))
            nid_hash = worker_system.blind_index(DATA_DIR, nid)
            current = self.current_user()
            if current["role"] == "worker":
                people = case_data.get("people") or []
                nominee = people[1] if len(people) > 1 else {}
                declaration = case_data.get("declaration") or {}
                applicant_ok = applicant.get("idFront") and applicant.get("idBack") and applicant.get("photo") and len(nid) >= 10
                nominee_identity = nominee.get("birthCertificate") or (nominee.get("idFront") and nominee.get("idBack"))
                if not (applicant_ok and nominee.get("photo") and nominee_identity):
                    raise ValueError("Applicant NID Front/Back/Photo এবং Nominee Photo ও NID অথবা Birth Certificate বাধ্যতামূলক")
                if not str(declaration.get("monthlyIncome", "")).strip() or not str(declaration.get("rawDescription", "")).strip():
                    raise ValueError("মাসিক আয় এবং Income Declaration details বাধ্যতামূলক")
                if not case_data.get("customerConsent"):
                    raise ValueError("গ্রাহকের সম্মতি নিশ্চিত করুন")
            case_json = json.dumps(case_data, ensure_ascii=False)
            now = datetime.now(timezone.utc).isoformat()
            with db() as con:
                if nid_hash:
                    duplicate = con.execute("SELECT serial,name FROM customers WHERE applicant_nid_hash=?", (nid_hash,)).fetchone()
                    if duplicate: raise ValueError(f"এই Applicant NID আগে {duplicate['serial']} ({duplicate['name']}) নামে জমা হয়েছে")
                cursor = con.execute("""INSERT INTO customers(serial,name,name_bn,customer_number,phone,email,archive_name,archive_path,created_at,created_by,case_json)
                    VALUES(NULL,?,?,?,?,?,'','',?,?,?)""", (name, str(data.get("nameBn", "")).strip(), str(data.get("customerNumber", "")).strip(),
                    str(data.get("phone", "")).strip(), str(data.get("email", "")).strip(), now, self.user(), case_json))
                customer_id = cursor.lastrowid; serial = f"CUST-{customer_id:06d}"
            filename = f"{safe(name)}_{safe(str(data.get('phone', '')).strip() or 'NO-MOBILE')}{suffix}"
            path = ARCHIVE_DIR / f"{serial}_{filename}"
            try:
                path.write_bytes(content)
            except Exception:
                with db() as con: con.execute("DELETE FROM customers WHERE id=? AND archive_path=''", (customer_id,))
                raise
            with db() as con:
                con.execute("UPDATE customers SET serial=?,archive_name=?,archive_path=?,workflow_status='submitted',submitted_at=?,applicant_nid_hash=? WHERE id=?", (serial, filename, str(path.resolve()), now, nid_hash, customer_id))
                worker_system.audit(con, self.user(), "customer_submitted", "customer", customer_id)
            return self.reply(201, {"id": customer_id, "serial": serial, "archiveName": filename, "status": "submitted"})
        except Exception as error: return self.reply(400, {"error": str(error)})

    def update_customer(self, customer_id):
        try:
            data = self.body(); name = str(data.get("name", "")).strip().upper(); archive = str(data.get("archive", ""))
            if not name: raise ValueError("Customer name দিন")
            content, suffix = archive_payload(data)
            case_json = json.dumps(data.get("case") or {}, ensure_ascii=False)
            with db() as con:
                row = con.execute("SELECT serial,archive_path FROM customers WHERE id=?", (customer_id,)).fetchone()
                if not row: return self.reply(404, {"error": "Customer পাওয়া যায়নি"})
                filename = f"{safe(name)}_{safe(str(data.get('phone', '')).strip() or 'NO-MOBILE')}{suffix}"
                path = ARCHIVE_DIR / f"{row['serial']}_{filename}"
                old_path = Path(row["archive_path"]); path.write_bytes(content)
                if old_path != path and old_path.is_file() and old_path.parent.resolve() == ARCHIVE_DIR.resolve(): old_path.unlink()
                con.execute("""UPDATE customers SET name=?,name_bn=?,customer_number=?,phone=?,email=?,archive_name=?,archive_path=?,case_json=? WHERE id=?""",
                    (name, str(data.get("nameBn", "")).strip(), str(data.get("customerNumber", "")).strip(), str(data.get("phone", "")).strip(),
                     str(data.get("email", "")).strip(), filename, str(path.resolve()), case_json, customer_id))
            return self.reply(200, {"id": customer_id, "serial": row["serial"], "archiveName": filename})
        except Exception as error: return self.reply(400, {"error": str(error)})

    def ocr(self):
        try:
            data = self.body(); api_key = str(data.get("apiKey", "")).strip(); image = str(data.get("image", ""))
            if not api_key or not image.startswith("data:image/"): raise ValueError("API key বা ID image পাওয়া যায়নি")
            prompt = """Read this Bangladesh ID card and return one valid JSON object only.
Use exactly these string keys: name, nameBn, nid, dob, addressBn, addressEn, text.
Copy the English name exactly with all internal spaces, then uppercase it. Copy the Bangla name exactly. NID must contain digits only.
addressBn must contain village/road and post on line 1, then thana and district on line 2.
addressEn must translate/transliterate the same values in UPPERCASE using the same two-line layout.
Inside JSON strings encode every line break as \\n. Do not place a literal newline inside a quoted JSON string.
Never include parents' names, never guess unreadable values, and add no markdown or explanation."""
            line_prompt = """Read this Bangladesh ID card. Return exactly these 9 labelled lines, with no JSON, markdown, or explanation:
NAME_EN: English name copied exactly with spaces and converted to uppercase
NAME_BN: Bangla name copied exactly
NID: digits only
DOB: date of birth
ADDRESS_BN_1: গ্রাম/রোড and ডাকঘর
ADDRESS_BN_2: থানা and জেলা
ADDRESS_EN_1: uppercase VILLAGE/ROAD and POST translation/transliteration
ADDRESS_EN_2: uppercase THANA and DISTRICT translation/transliteration
TEXT: any other useful visible text
Use an empty value after the label when unreadable. Never include parents' names in addresses."""
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "DocumentStudio/1.0"}
            request = urllib.request.Request("https://api.groq.com/openai/v1/models", headers=headers)
            with urllib.request.urlopen(request, timeout=30) as response: available = {m.get("id", "") for m in json.loads(response.read()).get("data", [])}
            preferred = ["meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3.6-27b", "qwen/qwen3-vl-32b-instruct"]
            models = [m for m in preferred if m in available] + [m for m in sorted(available) if any(x in m.lower() for x in ("vision", "-vl-", "scout")) and m not in preferred]
            if not models: raise PermissionError("Groq account-এ Vision model চালু নেই")
            parsed = None; last_error = ""
            for model in models:
                for force_json in (True, False):
                    active_prompt = prompt if force_json else line_prompt
                    request_data = {"model": model, "temperature": 0, "max_tokens": 2000,
                        "messages": [{"role": "user", "content": [{"type": "text", "text": active_prompt},
                        {"type": "image_url", "image_url": {"url": image}}]}]}
                    if force_json:
                        request_data["response_format"] = {"type": "json_object"}
                    payload = json.dumps(request_data).encode()
                    try:
                        request = urllib.request.Request("https://api.groq.com/openai/v1/chat/completions", data=payload, headers=headers, method="POST")
                        with urllib.request.urlopen(request, timeout=90) as response: result = json.loads(response.read())
                        message = result.get("choices", [{}])[0].get("message", {})
                        content = str(message.get("content") or message.get("reasoning") or "").strip()
                        if content.startswith("```"):
                            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
                        start, end = content.find("{"), content.rfind("}")
                        if start >= 0 and end > start:
                            content = content[start:end + 1]
                        if not content:
                            last_error = f"{model} কোনো লেখা ফেরত দেয়নি"
                            continue
                        if not force_json:
                            labels = {}
                            for line in content.splitlines():
                                label, separator, value = line.strip().partition(":")
                                normalized = label.strip().upper().replace(" ", "_")
                                if separator and normalized in {"NAME_EN", "NAME_BN", "NID", "DOB", "ADDRESS_BN_1", "ADDRESS_BN_2", "ADDRESS_EN_1", "ADDRESS_EN_2", "TEXT"}:
                                    labels[normalized] = value.strip()
                            if any(labels.get(key) for key in ("NAME_EN", "NAME_BN", "NID")):
                                parsed = {"name": labels.get("NAME_EN", ""), "nameBn": labels.get("NAME_BN", ""),
                                    "nid": labels.get("NID", ""), "dob": labels.get("DOB", ""),
                                    "addressBn": "\n".join(filter(None, (labels.get("ADDRESS_BN_1"), labels.get("ADDRESS_BN_2")))),
                                    "addressEn": "\n".join(filter(None, (labels.get("ADDRESS_EN_1"), labels.get("ADDRESS_EN_2")))),
                                    "text": labels.get("TEXT", "")}
                                break
                            last_error = f"{model} থেকে ID field পাওয়া যায়নি"
                        else:
                            try:
                                candidate = json.loads(content)
                                if isinstance(candidate, dict):
                                    parsed = candidate
                                    break
                                last_error = f"{model} JSON object ফেরত দেয়নি"
                            except json.JSONDecodeError:
                                last_error = f"{model} সঠিক JSON ফেরত দেয়নি"
                    except urllib.error.HTTPError as error:
                        try: last_error = json.loads(error.read()).get("error", {}).get("message", str(error))
                        except Exception: last_error = str(error)
                        if error.code not in (400, 403, 404): raise
                if parsed is not None:
                    break
            if parsed is None: raise ValueError(last_error or "AI থেকে ID details পাওয়া যায়নি; পরিষ্কার ছবি দিয়ে আবার চেষ্টা করুন")
            clean = {k: str(parsed.get(k, "") or "").strip() for k in ("name", "nameBn", "nid", "dob", "addressBn", "addressEn", "text")}
            clean["nid"] = "".join(c for c in clean["nid"] if c.isdigit()); clean["name"] = clean["name"].upper(); clean["addressEn"] = clean["addressEn"].upper()
            return self.reply(200, clean)
        except urllib.error.HTTPError as error:
            try: message = json.loads(error.read()).get("error", {}).get("message", str(error))
            except Exception: message = str(error)
            return self.reply(error.code, {"error": message})
        except Exception as error: return self.reply(500, {"error": str(error)})

    def reply(self, status, value, cookie=None, clear=False):
        content = json.dumps(value, ensure_ascii=False).encode(); self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Cache-Control", "no-store")
        if cookie: self.send_header("Set-Cookie", f"ds_session={cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_DAYS * 86400}")
        if clear: self.send_header("Set-Cookie", "ds_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
        self.send_header("Content-Length", str(len(content))); self.end_headers(); self.wfile.write(content)

if __name__ == "__main__":
    mimetypes.add_type("application/wasm", ".wasm"); initialize()
    print(f"Document Studio is running locally: http://127.0.0.1:{PORT}/")
    print(f"Phone access (same Wi-Fi): http://YOUR-PC-IP:{PORT}/")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
