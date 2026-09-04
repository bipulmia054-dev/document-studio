import base64, hashlib, hmac, json, re, secrets
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


def digits(value):
    return "".join(c for c in str(value or "") if c.isdigit())


def add_column(con, table, definition):
    name = definition.split()[0]
    columns = {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    if name not in columns:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def secret_key(data_dir):
    path = Path(data_dir) / ".application-secret"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(32), encoding="ascii")
    return path.read_text(encoding="ascii").strip().encode()


def blind_index(data_dir, value):
    normalized = digits(value)
    if not normalized:
        return ""
    return hmac.new(secret_key(data_dir), normalized.encode(), hashlib.sha256).hexdigest()


def initialize(con, data_dir):
    for definition in (
        "role TEXT NOT NULL DEFAULT 'worker'", "status TEXT NOT NULL DEFAULT 'pending'",
        "full_name TEXT DEFAULT ''", "phone TEXT DEFAULT ''", "email TEXT DEFAULT ''",
        "address TEXT DEFAULT ''", "payout_account_name TEXT DEFAULT ''",
        "payout_account_number TEXT DEFAULT ''", "payout_branch TEXT DEFAULT ''",
        "nid_hash TEXT DEFAULT ''", "nid_last4 TEXT DEFAULT ''", "registration_json TEXT DEFAULT ''",
        "approved_by TEXT DEFAULT ''", "approved_at TEXT DEFAULT ''", "rejection_reason TEXT DEFAULT ''",
        "referral_code TEXT DEFAULT ''", "referred_by INTEGER", "profile_json TEXT DEFAULT ''",
        "nid_number TEXT DEFAULT ''"
    ):
        add_column(con, "users", definition)
    for definition in (
        "workflow_status TEXT NOT NULL DEFAULT 'submitted'", "applicant_nid_hash TEXT DEFAULT ''",
        "submitted_at TEXT DEFAULT ''", "data_approved_at TEXT DEFAULT ''",
        "account_completed_at TEXT DEFAULT ''", "bank_account_number TEXT DEFAULT ''",
        "correction_note TEXT DEFAULT ''", "recollection_json TEXT DEFAULT ''",
        "revision INTEGER NOT NULL DEFAULT 1", "reviewed_by TEXT DEFAULT ''", "reviewed_at TEXT DEFAULT ''"
    ):
        add_column(con, "customers", definition)
    ensure_master_admin(con)
    first = con.execute("SELECT id,role FROM users ORDER BY id LIMIT 1").fetchone()
    if first and first["role"] == "admin":
        con.execute("UPDATE users SET role='admin',status='approved',approved_at=COALESCE(NULLIF(approved_at,''),created_at) WHERE id=?", (first[0],))
    con.execute("""CREATE TABLE IF NOT EXISTS transactions(
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, customer_id INTEGER,
        event_key TEXT NOT NULL UNIQUE, type TEXT NOT NULL, amount_paisa INTEGER NOT NULL,
        reason TEXT DEFAULT '', reference TEXT DEFAULT '', created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))""")
    add_column(con, "transactions", "source_user_id INTEGER")
    con.execute("""UPDATE transactions SET source_user_id=(SELECT u.id FROM customers c
        JOIN users u ON u.username=c.created_by WHERE c.id=transactions.customer_id)
        WHERE type='referral_commission' AND source_user_id IS NULL AND customer_id IS NOT NULL""")
    con.execute("""CREATE TABLE IF NOT EXISTS withdrawals(
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount_paisa INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'requested', account_name TEXT NOT NULL,
        account_number TEXT NOT NULL, branch TEXT DEFAULT '', reference TEXT DEFAULT '',
        note TEXT DEFAULT '', requested_at TEXT NOT NULL, processed_at TEXT DEFAULT '',
        processed_by TEXT DEFAULT '', FOREIGN KEY(user_id) REFERENCES users(id))""")
    con.execute("""CREATE TABLE IF NOT EXISTS audit_log(
        id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
        entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata_json TEXT DEFAULT '',
        created_at TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS targets(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, metric TEXT NOT NULL,
        required_count INTEGER NOT NULL, bonus_paisa INTEGER NOT NULL,
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, user_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS recollections(
        id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, fields_json TEXT NOT NULL,
        note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested',
        requested_by TEXT NOT NULL, requested_at TEXT NOT NULL,
        submitted_at TEXT DEFAULT '', reviewed_at TEXT DEFAULT '')""")
    con.execute("""CREATE TABLE IF NOT EXISTS notifications(
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL,
        message TEXT NOT NULL, read_at TEXT DEFAULT '', created_at TEXT NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS announcements(
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        image_data TEXT DEFAULT '', target_user_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL)""")
    for row in con.execute("SELECT id FROM users WHERE referral_code='' OR referral_code IS NULL").fetchall():
        con.execute("UPDATE users SET referral_code=? WHERE id=?", (f"TW{row[0]:05d}", row[0]))
    con.execute("CREATE INDEX IF NOT EXISTS idx_users_status_role ON users(status,role)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_customers_created_by ON customers(created_by,id DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_customers_workflow ON customers(workflow_status,id DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_customers_nid_hash ON customers(applicant_nid_hash)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id,id DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_transactions_referral_source ON transactions(user_id,source_user_id,type)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id,id DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_recollections_customer ON recollections(customer_id,id DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_targets_active_dates ON targets(active,starts_at,ends_at)")
    for key, value in (("collection_reward_paisa", "5000"), ("completion_reward_paisa", "5000"), ("referral_percent", "10"), ("support_whatsapp", "")):
        con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (key, value))
    con.execute("PRAGMA optimize")


def save_data_image(value, folder, name):
    value = str(value or "")
    match = re.match(r"data:image/(jpeg|jpg|png|webp);base64,(.+)$", value, re.I | re.S)
    if not match:
        raise ValueError(f"{name} image αªªαª┐αª¿")
    raw = base64.b64decode(match.group(2), validate=True)
    if not 5_000 <= len(raw) <= 12 * 1024 * 1024:
        raise ValueError(f"{name} image αª╕αªáαª┐αªò αª¿αºƒ")
    ext = ".jpg" if match.group(1).lower() in ("jpeg", "jpg") else "." + match.group(1).lower()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (name + ext)
    path.write_bytes(raw)
    return str(path.resolve())


def public_user(row):
    return {"id": row["id"], "username": row["username"], "role": row["role"],
            "status": row["status"], "fullName": row["full_name"], "phone": row["phone"]}


def is_admin_role(role):
    return role in ("master_admin", "admin", "subadmin")


def ensure_master_admin(con):
    master = con.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", ("Bipul",)).fetchone()
    salt = secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac("sha256", b"Bipul098", bytes.fromhex(salt), 310000).hex()
    if master:
        if master["role"] == "master_admin":
            con.execute("UPDATE users SET status='approved',full_name='Bipul',referral_code=COALESCE(NULLIF(referral_code,''),'MASTER-BIPUL') WHERE id=?", (master["id"],))
        else:
            con.execute("UPDATE users SET role='master_admin',status='approved',full_name='Bipul',password_hash=?,salt=?,referral_code='MASTER-BIPUL' WHERE id=?",
                         (password_hash, salt, master["id"]))
        con.execute("DELETE FROM sessions WHERE username!='Bipul'")
        con.execute("DELETE FROM users WHERE role='admin' AND id!=?", (master["id"],))
    else:
        con.execute("DELETE FROM users WHERE role='admin'")
        con.execute("""INSERT INTO users(username,password_hash,salt,created_at,role,status,full_name,approved_at,referral_code)
                 VALUES(?,?,?,?, 'master_admin','approved','Bipul',?, 'MASTER-BIPUL')""",
                     ("Bipul", password_hash, salt, now(), now()))


def balance(con, user_id):
    earned = con.execute("SELECT COALESCE(SUM(amount_paisa),0) FROM transactions WHERE user_id=?", (user_id,)).fetchone()[0]
    reserved = con.execute("SELECT COALESCE(SUM(amount_paisa),0) FROM withdrawals WHERE user_id=? AND status IN ('requested','approved','paid')", (user_id,)).fetchone()[0]
    return int(earned), int(reserved), int(earned - reserved)


def audit(con, actor, action, entity_type, entity_id, metadata=None):
    con.execute("INSERT INTO audit_log(actor,action,entity_type,entity_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)",
                (actor, action, entity_type, str(entity_id), json.dumps(metadata or {}, ensure_ascii=False), now()))


def notify(con, user_id, title, message):
    con.execute("INSERT INTO notifications(user_id,title,message,created_at) VALUES(?,?,?,?)",
                (user_id, title, message, now()))


def award(con, worker, customer_id, event_key, kind, amount, reason, actor):
    result = con.execute("""INSERT OR IGNORE INTO transactions(user_id,customer_id,event_key,type,amount_paisa,reason,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?)""", (worker["id"], customer_id, event_key, kind, amount, reason, actor, now()))
    if not result.rowcount:
        return
    notify(con, worker["id"], "αª¿αªñαºüαª¿ αªåαºƒ αª»αºïαªù αª╣αºƒαºçαª¢αºç", f"{reason}: αº│{amount / 100:g}")
    if worker["referred_by"] and kind in ("collection_reward", "completion_reward", "bonus", "target_bonus") and amount > 0:
        referrer = con.execute("SELECT id,status FROM users WHERE id=?", (worker["referred_by"],)).fetchone()
        if referrer and referrer["status"] == "approved":
            rate_row = con.execute("SELECT value FROM settings WHERE key='referral_percent'").fetchone()
            commission = round(amount * float(rate_row[0] if rate_row else 10) / 100)
            con.execute("""INSERT OR IGNORE INTO transactions(user_id,customer_id,event_key,type,amount_paisa,reason,created_by,created_at,source_user_id)
                VALUES(?,?,?,?,?,?,?,?,?)""", (referrer["id"], customer_id, "referral:" + event_key,
                "referral_commission", commission, f"{worker['full_name'] or worker['username']}-αªÅαª░ αªåαºƒαºçαª░ referral commission", actor, now(), worker["id"]))
            notify(con, referrer["id"], "Referral commission", f"αº│{commission / 100:g} αª»αºïαªù αª╣αºƒαºçαª¢αºç")


def target_progress(con, user_id):
    stamp = now()
    rows = con.execute("""SELECT * FROM targets WHERE active=1 AND starts_at<=? AND ends_at>=?
        AND (user_id IS NULL OR user_id=?) ORDER BY id DESC""", (stamp, stamp, user_id)).fetchall()
    output = []
    for target in rows:
        if target["metric"] == "completed":
            count = con.execute("""SELECT COUNT(*) FROM customers c JOIN users u ON u.username=c.created_by
                WHERE u.id=? AND c.workflow_status='completed' AND c.account_completed_at BETWEEN ? AND ?""",
                (user_id, target["starts_at"], target["ends_at"])).fetchone()[0]
        else:
            count = con.execute("""SELECT COUNT(*) FROM customers c JOIN users u ON u.username=c.created_by
                WHERE u.id=? AND c.data_approved_at!='' AND c.data_approved_at BETWEEN ? AND ?""",
                (user_id, target["starts_at"], target["ends_at"])).fetchone()[0]
        output.append({**dict(target), "progress": count})
        if count >= target["required_count"]:
            worker = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            award(con, worker, None, f"target:{target['id']}:{user_id}", "target_bonus",
                  target["bonus_paisa"], f"Target bonus ΓÇö {target['name']}", "SYSTEM")
    return output


def dispatch(handler, method, path, db, data_dir, digest):
    if path == "/api/worker/register" and method == "POST":
        try:
            data = handler.body(40 * 1024 * 1024)
            username = str(data.get("username", "")).strip()
            password = str(data.get("password", ""))
            full_name = str(data.get("fullName", "")).strip()
            phone = digits(data.get("phone"))
            nid_number = digits(data.get("nidNumber"))
            if len(username) < 3 or len(password) < 8: raise ValueError("Username αªòαª«αª¬αªòαºìαª╖αºç αº⌐ αªÅαª¼αªé password αº« αªàαªòαºìαª╖αª░αºçαª░ αªªαª┐αª¿")
            if not full_name or len(phone) < 10: raise ValueError("αª¬αºéαª░αºìαªú αª¿αª╛αª« αªô αª╕αªáαª┐αªò mobile number αªªαª┐αª¿")
            if len(nid_number) not in (10, 13, 17): raise ValueError("αª╕αªáαª┐αªò NID number αªªαª┐αª¿")
            with db() as con:
                if con.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone(): raise ValueError("αªÅαªç username αªåαªùαºç αª¼αºìαª»αª¼αª╣αª╛αª░ αª╣αºƒαºçαª¢αºç")
                referral = str(data.get("referralCode", "")).strip().upper()
                if not referral: raise ValueError("Registration-αªÅαª░ αª£αª¿αºìαª» Referral code αª¼αª╛αªºαºìαª»αªñαª╛αª«αºéαª▓αªò")
                referrer = con.execute("SELECT id FROM users WHERE referral_code=? AND status='approved'", (referral,)).fetchone()
                if not referrer: raise ValueError("Referral code αª╕αªáαª┐αªò αª¿αºƒ αªàαªÑαª¼αª╛ Worker approved αª¿αºƒ")
                salt = secrets.token_hex(16)
                cur = con.execute("""INSERT INTO users(username,password_hash,salt,created_at,role,status,full_name,phone,email,address,
                    payout_account_name,payout_account_number,payout_branch,nid_hash,nid_last4,referred_by,nid_number)
                    VALUES(?,?,?,?, 'worker','pending',?,?,?,?,?,?,?,?,?,?,?)""",
                    (username, digest(password, salt), salt, now(), full_name, phone, str(data.get("email", "")).strip(),
                     str(data.get("address", "")).strip(), "", "", "", blind_index(data_dir, nid_number), nid_number[-4:], referrer["id"], nid_number))
                user_id = cur.lastrowid
                con.execute("UPDATE users SET referral_code=? WHERE id=?", (f"TW{user_id:05d}", user_id))
                folder = Path(data_dir) / "worker_registration" / f"worker-{user_id:06d}"
                files = {"nidFront": save_data_image(data.get("nidFront"), folder, "nid-front"),
                         "nidBack": save_data_image(data.get("nidBack"), folder, "nid-back"),
                         "selfie": save_data_image(data.get("selfie"), folder, "selfie")}
                con.execute("UPDATE users SET registration_json=? WHERE id=?", (json.dumps(files), user_id))
                audit(con, username, "worker_registered", "user", user_id)
            return handler.reply(201, {"ok": True, "message": "Registration αª£αª«αª╛ αª╣αºƒαºçαª¢αºçαÑñ Admin approval-αªÅαª░ αª£αª¿αºìαª» αªàαª¬αºçαªòαºìαª╖αª╛ αªòαª░αºüαª¿αÑñ"})
        except Exception as error:
            return handler.reply(400, {"error": str(error)})

    user = handler.current_user()
    if not user:
        return handler.reply(401, {"error": "αªåαª¼αª╛αª░ Login αªòαª░αºüαª¿"})
    if user["status"] != "approved":
        return handler.reply(403, {"error": "Account αª¼αª░αºìαªñαª«αª╛αª¿αºç locked/suspended αªåαª¢αºç"})

    if path == "/api/worker/dashboard" and method == "GET":
        with db() as con:
            counts = {r["workflow_status"]: r["count"] for r in con.execute("SELECT workflow_status,COUNT(*) count FROM customers WHERE created_by=? GROUP BY workflow_status", (user["username"],))}
            earned, reserved, available = balance(con, user["id"])
            totals = {r["type"]: r["total"] for r in con.execute("SELECT type,COALESCE(SUM(amount_paisa),0) total FROM transactions WHERE user_id=? GROUP BY type", (user["id"],))}
            targets = target_progress(con, user["id"])
            notifications = [dict(r) for r in con.execute("SELECT id,title,message,created_at FROM notifications WHERE user_id=? AND read_at='' ORDER BY id DESC LIMIT 10", (user["id"],))]
        return handler.reply(200, {"counts": counts, "earned": earned, "reserved": reserved, "available": available,
            "withdrawn": reserved, "bonus": totals.get("bonus",0)+totals.get("target_bonus",0),
            "referralIncome": totals.get("referral_commission",0), "targets": targets, "notifications": notifications})

    if path == "/api/worker/customers" and method == "GET":
        with db() as con:
            rows = con.execute("SELECT id,serial,name,phone,workflow_status,created_at,case_json,correction_note FROM customers WHERE created_by=? ORDER BY id DESC LIMIT 200", (user["username"],)).fetchall()
        output = []
        for row in rows:
            try: case = json.loads(row["case_json"] or "{}")
            except Exception: case = {}
            people = case.get("people") or []
            nominee = people[1].get("name", "") if len(people) > 1 else ""
            output.append({"id": row["id"], "serial": row["serial"], "name": row["name"],
                           "phone": ("******" + row["phone"][-4:]) if row["phone"] else "",
                           "nominee": nominee, "status": row["workflow_status"],
                           "correctionNote": row["correction_note"], "createdAt": row["created_at"]})
        return handler.reply(200, {"customers": output})

    if path == "/api/worker/transactions" and method == "GET":
        with db() as con:
            rows = con.execute("""SELECT t.id,t.type,t.amount_paisa,t.reason,t.reference,t.created_at,
                c.serial,c.name customer_name FROM transactions t LEFT JOIN customers c ON c.id=t.customer_id
                WHERE t.user_id=? ORDER BY t.id DESC""", (user["id"],)).fetchall()
            withdrawals = con.execute("SELECT id,amount_paisa,status,reference,note,requested_at FROM withdrawals WHERE user_id=? ORDER BY id DESC", (user["id"],)).fetchall()
        return handler.reply(200, {"transactions": [dict(r) for r in rows], "withdrawals": [dict(r) for r in withdrawals]})

    if path == "/api/worker/profile" and method == "GET":
        with db() as con:
            referrals = [dict(row) for row in con.execute("""SELECT u.id,u.full_name,
                COALESCE(SUM(CASE WHEN t.type='referral_commission' THEN t.amount_paisa ELSE 0 END),0) income_paisa
                FROM users u LEFT JOIN transactions t ON t.user_id=? AND t.source_user_id=u.id
                WHERE u.referred_by=? GROUP BY u.id,u.full_name ORDER BY u.id DESC""", (user["id"], user["id"])).fetchall()]
            referral_income = sum(int(row["income_paisa"] or 0) for row in referrals)
            support = con.execute("SELECT value FROM settings WHERE key='support_whatsapp'").fetchone()
        return handler.reply(200, {"profile": {**public_user(user), "email": user["email"], "address": user["address"],
            "nidNumber": user["nid_number"], "referralCode": user["referral_code"], "joinedAt": user["created_at"],
            "referralIncome": referral_income, "referrals": referrals,
            "bankAccount": {"configured": bool(user["payout_account_number"]), "accountName": user["payout_account_name"],
                "accountNumberMasked": ("******" + user["payout_account_number"][-4:]) if user["payout_account_number"] else "",
                "branch": user["payout_branch"]}, "supportWhatsApp": support[0] if support else ""}})

    if path == "/api/worker/announcements" and method == "GET":
        with db() as con:
            rows = [dict(row) for row in con.execute("""SELECT id,title,description,image_data,created_at FROM announcements
                WHERE active=1 AND (target_user_id IS NULL OR target_user_id=?) ORDER BY id DESC LIMIT 20""", (user["id"],)).fetchall()]
        return handler.reply(200, {"announcements": rows})

    if path == "/api/worker/bank-account" and method == "POST":
        try:
            data = handler.body(8192); account_name = str(data.get("accountName", "")).strip()
            account_number = digits(data.get("accountNumber")); branch = str(data.get("branch", "")).strip()
            if not account_name or len(account_number) < 8 or not branch: raise ValueError("Account name, number αªô branch αªªαª┐αª¿")
            with db() as con:
                current = con.execute("SELECT payout_account_number FROM users WHERE id=?", (user["id"],)).fetchone()
                if current and current[0]: raise ValueError("Bank account αªÅαªòαª¼αª╛αª░ Save αª╣αºƒαºçαª¢αºç; αª¬αª░αª┐αª¼αª░αºìαªñαª¿αºçαª░ αª£αª¿αºìαª» Admin-αªÅαª░ αª╕αª╛αªÑαºç αª»αºïαªùαª╛αª»αºïαªù αªòαª░αºüαª¿")
                con.execute("UPDATE users SET payout_account_name=?,payout_account_number=?,payout_branch=? WHERE id=?",
                            (account_name, account_number, branch, user["id"]))
                audit(con, user["username"], "bank_account_added", "user", user["id"], {"last4": account_number[-4:]})
            return handler.reply(201, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if path == "/api/worker/password" and method == "POST":
        try:
            data = handler.body(8192); old_password = str(data.get("oldPassword", "")); new_password = str(data.get("newPassword", ""))
            if not hmac.compare_digest(user["password_hash"], digest(old_password, user["salt"])): raise ValueError("αª¼αª░αºìαªñαª«αª╛αª¿ password αª╕αªáαª┐αªò αª¿αºƒ")
            if len(new_password) < 8: raise ValueError("αª¿αªñαºüαª¿ password αªòαª«αª¬αªòαºìαª╖αºç αº« αªàαªòαºìαª╖αª░αºçαª░ αªªαª┐αª¿")
            salt = secrets.token_hex(16)
            with db() as con:
                con.execute("UPDATE users SET password_hash=?,salt=? WHERE id=?", (digest(new_password, salt), salt, user["id"]))
                audit(con, user["username"], "password_changed", "user", user["id"])
            return handler.reply(200, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    match = re.fullmatch(r"/api/worker/customers/(\d+)", path)
    if match and method == "GET":
        with db() as con:
            row = con.execute("SELECT * FROM customers WHERE id=? AND created_by=?", (int(match.group(1)), user["username"])).fetchone()
            if not row: return handler.reply(404, {"error": "Customer αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐"})
            request = con.execute("SELECT * FROM recollections WHERE customer_id=? AND status='requested' ORDER BY id DESC LIMIT 1", (row["id"],)).fetchone()
        case = json.loads(row["case_json"] or "{}")
        people = case.get("people") or []
        safe_people = [{k:p.get(k,"") for k in ("role","name","nameBn","nid","dob","fatherNameEn","motherNameEn","fatherNameBn","motherNameBn","addressEn","addressBn","profession","identityType")} for p in people]
        declaration = case.get("declaration") or {}
        return handler.reply(200, {"customer": {"id": row["id"], "serial": row["serial"], "name": row["name"],
            "status": row["workflow_status"], "details": case.get("details") or {}, "people": safe_people,
            "declaration": {k:declaration.get(k,"") for k in ("monthlyIncome","rawDescription","polishedDescription")},
            "recollection": ({**dict(request), "fields": json.loads(request["fields_json"])} if request else None)}})

    if match and method == "PUT":
        try:
            customer_id = int(match.group(1)); data = handler.body(35 * 1024 * 1024)
            with db() as con:
                row = con.execute("SELECT * FROM customers WHERE id=? AND created_by=? AND workflow_status='correction_required'", (customer_id,user["username"])).fetchone()
                request = con.execute("SELECT * FROM recollections WHERE customer_id=? AND status='requested' ORDER BY id DESC LIMIT 1", (customer_id,)).fetchone()
                if not row or not request: raise ValueError("αªÅαªç Customer-αªÅαª░ active recollection αª¿αºçαªç")
                allowed = set(json.loads(request["fields_json"])); patch = data.get("patch") or {}
                if not patch or any(key not in allowed for key in patch): raise ValueError("αª╢αºüαªºαºü Admin αªÜαª╛αªôαºƒαª╛ αªñαªÑαºìαª» αªåαª¼αª╛αª░ αª£αª«αª╛ αªªαª┐αª¿")
                case = json.loads(row["case_json"] or "{}")
                for key,value in patch.items():
                    parts=key.split("."); target=case
                    for part in parts[:-1]:
                        target = target[int(part)] if isinstance(target,list) else target.setdefault(part,{})
                    last=parts[-1]
                    if isinstance(target,list): target[int(last)]=value
                    else: target[last]=value
                con.execute("UPDATE customers SET case_json=?,workflow_status='resubmitted',revision=revision+1,correction_note='' WHERE id=?",
                            (json.dumps(case,ensure_ascii=False),customer_id))
                con.execute("UPDATE recollections SET status='submitted',submitted_at=? WHERE id=?", (now(),request["id"]))
                audit(con,user["username"],"recollection_submitted","customer",customer_id,{"fields":list(patch)})
            return handler.reply(200,{"ok":True})
        except Exception as error: return handler.reply(400,{"error":str(error)})

    if path == "/api/worker/withdrawals" and method == "POST":
        try:
            data = handler.body(8192); amount = round(float(data.get("amount", 0)) * 100)
            with db() as con:
                bank = con.execute("SELECT payout_account_name,payout_account_number,payout_branch FROM users WHERE id=?", (user["id"],)).fetchone()
                if not bank or not bank["payout_account_number"]: raise ValueError("αªåαªùαºç Profile αªÑαºçαªòαºç City Bank account αª»αºïαªù αªòαª░αºüαª¿")
                earned, reserved, available = balance(con, user["id"])
                if amount <= 0 or amount > available: raise ValueError("Available balance-αªÅαª░ αª«αªºαºìαª»αºç amount αªªαª┐αª¿")
                con.execute("INSERT INTO withdrawals(user_id,amount_paisa,status,account_name,account_number,branch,note,requested_at) VALUES(?,?,'requested',?,?,?,?,?)",
                            (user["id"], amount, bank["payout_account_name"], bank["payout_account_number"], bank["payout_branch"], str(data.get("note", ""))[:300], now()))
                audit(con, user["username"], "withdrawal_requested", "user", user["id"], {"amountPaisa": amount})
            return handler.reply(201, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if not is_admin_role(user["role"]):
        return handler.reply(403, {"error": "αª╢αºüαªºαºü Admin αªÅαªç αªòαª╛αª£ αªòαª░αªñαºç αª¬αª╛αª░αª¼αºçαª¿"})

    if path == "/api/admin/dashboard" and method == "GET":
        with db() as con:
            users = con.execute("SELECT status,COUNT(*) count FROM users WHERE role='worker' GROUP BY status").fetchall()
            cases = con.execute("SELECT workflow_status,COUNT(*) count FROM customers GROUP BY workflow_status").fetchall()
            total_paid = con.execute("SELECT COALESCE(SUM(amount_paisa),0) FROM transactions").fetchone()[0]
        return handler.reply(200, {"users": {r[0]: r[1] for r in users}, "cases": {r[0]: r[1] for r in cases}, "totalRewards": total_paid})

    if path == "/api/admin/finance" and method == "GET":
        with db() as con:
            workers = [dict(r) for r in con.execute("""SELECT u.id,u.username,u.full_name,u.phone,
                COALESCE(SUM(t.amount_paisa),0) total_income,
                COALESCE(SUM(CASE WHEN t.type='bonus' THEN t.amount_paisa ELSE 0 END),0) bonus,
                COALESCE(SUM(CASE WHEN t.type='target_bonus' THEN t.amount_paisa ELSE 0 END),0) target_bonus,
                COALESCE(SUM(CASE WHEN t.type='referral_commission' THEN t.amount_paisa ELSE 0 END),0) referral_income
                FROM users u LEFT JOIN transactions t ON t.user_id=u.id WHERE u.role='worker' GROUP BY u.id ORDER BY u.id DESC""")]
            for item in workers:
                paid = con.execute("SELECT COALESCE(SUM(amount_paisa),0) FROM withdrawals WHERE user_id=? AND status IN ('requested','approved','paid')", (item["id"],)).fetchone()[0]
                item["withdrawn"] = paid; item["balance"] = item["total_income"] - paid
            transactions = [dict(r) for r in con.execute("""SELECT t.*,u.full_name,u.username,c.serial,c.name customer_name
                FROM transactions t JOIN users u ON u.id=t.user_id LEFT JOIN customers c ON c.id=t.customer_id ORDER BY t.id DESC LIMIT 500""")]
            settings = {r["key"]: r["value"] for r in con.execute("SELECT key,value FROM settings WHERE key IN ('collection_reward_paisa','completion_reward_paisa','referral_percent')")}
        return handler.reply(200, {"workers": workers, "transactions": transactions, "settings": settings})

    if path == "/api/admin/finance/adjust" and method == "POST":
        try:
            data = handler.body(8192); amount = round(float(data.get("amount", 0)) * 100); reason = str(data.get("reason", "")).strip(); worker_id = int(data.get("userId", 0))
            if not amount or not reason or not worker_id: raise ValueError("Worker, amount αªÅαª¼αªé αªòαª╛αª░αªú αªªαª┐αª¿")
            with db() as con:
                worker = con.execute("SELECT * FROM users WHERE id=? AND role='worker'", (worker_id,)).fetchone()
                if not worker: raise ValueError("Worker αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐")
                award(con, worker, None, "adjustment:" + secrets.token_hex(12), "manual_adjustment", amount, reason, user["username"])
                audit(con, user["username"], "finance_adjusted", "user", worker_id, {"amountPaisa": amount, "reason": reason})
            return handler.reply(201, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if path == "/api/admin/reward-settings" and method == "PUT":
        try:
            data = handler.body(8192); collection = round(float(data.get("collectionReward", 0)) * 100); completion = round(float(data.get("completionReward", 0)) * 100); referral = float(data.get("referralPercent", 0))
            if collection < 0 or completion < 0 or not 0 <= referral <= 100: raise ValueError("Reward settings αª╕αªáαª┐αªò αª¿αºƒ")
            with db() as con:
                for key, value in (("collection_reward_paisa", collection), ("completion_reward_paisa", completion), ("referral_percent", referral)):
                    con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))
                audit(con, user["username"], "reward_settings_changed", "settings", "rewards", data)
            return handler.reply(200, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if path == "/api/admin/users" and method == "GET":
        with db() as con:
            rows = con.execute("SELECT id,username,full_name,phone,email,address,status,role,nid_last4,payout_account_name,payout_account_number,payout_branch,created_at,rejection_reason,referral_code,referred_by FROM users WHERE role IN ('worker','subadmin') ORDER BY id DESC").fetchall()
        return handler.reply(200, {"users": [dict(r) for r in rows]})

    if path == "/api/admin/users" and method == "POST":
        try:
            data = handler.body(16384); username = str(data.get("username", "")).strip(); password = str(data.get("password", ""))
            full_name = str(data.get("fullName", "")).strip(); role = str(data.get("role", "worker")).strip()
            if role not in ("worker", "subadmin"): raise ValueError("শুধু Worker অথবা Subadmin account তৈরি করা যাবে")
            if role == "subadmin" and user["role"] != "master_admin": raise ValueError("শুধু Master Admin Subadmin তৈরি করতে পারবেন")
            if len(username) < 3 or len(password) < 8 or not full_name: raise ValueError("নাম, username এবং কমপক্ষে ৮ অক্ষরের password দিন")
            salt = secrets.token_hex(16)
            with db() as con:
                if con.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone(): raise ValueError("এই username আগে থেকেই আছে")
                cur = con.execute("INSERT INTO users(username,password_hash,salt,created_at,role,status,full_name,approved_by,approved_at,referral_code,referred_by) VALUES(?,?,?,?,?,'approved',?,?,?,?,?)",
                                  (username, hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310000).hex(), salt, now(), role, full_name, user["username"], now(), f"TW{secrets.token_hex(4).upper()}", data.get("referredBy") or None))
                audit(con, user["username"], "admin_user_created", "user", cur.lastrowid, {"role": role})
            return handler.reply(201, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if path == "/api/admin/referrals" and method == "GET":
        with db() as con:
            rows = [dict(r) for r in con.execute("SELECT id,username,full_name,role,status,referral_code,referred_by,created_at FROM users WHERE role IN ('worker','subadmin') ORDER BY id").fetchall()]
        return handler.reply(200, {"users": rows})

    match = re.fullmatch(r"/api/admin/users/(\d+)/profile", path)
    if match and method == "GET":
        with db() as con:
            profile = con.execute("SELECT id,username,full_name,phone,email,address,status,role,nid_number,nid_last4,referral_code,referred_by,created_at,payout_account_name,payout_account_number,payout_branch FROM users WHERE id=? AND role IN ('worker','subadmin')", (int(match.group(1)),)).fetchone()
            if not profile: return handler.reply(404, {"error": "User পাওয়া যায়নি"})
            earned, reserved, available = balance(con, profile["id"])
            transactions = [dict(r) for r in con.execute("SELECT id,type,amount_paisa,reason,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100", (profile["id"],)).fetchall()]
            customers = [dict(r) for r in con.execute("SELECT id,serial,name,workflow_status,created_at FROM customers WHERE created_by=? ORDER BY id DESC LIMIT 100", (profile["username"],)).fetchall()]
            children = [dict(r) for r in con.execute("SELECT id,username,full_name,role,status,referral_code FROM users WHERE referred_by=? ORDER BY id", (profile["id"],)).fetchall()]
        return handler.reply(200, {"profile": {**dict(profile), "payout_account_number": ("******" + profile["payout_account_number"][-4:]) if profile["payout_account_number"] else "", "earned": earned, "reserved": reserved, "available": available, "transactions": transactions, "customers": customers, "children": children}})

    match = re.fullmatch(r"/api/admin/users/(\d+)/balance", path)
    if match and method == "POST":
        try:
            data = handler.body(8192); amount = round(float(data.get("amount", 0)) * 100); reason = str(data.get("reason", "")).strip()
            if not amount or not reason: raise ValueError("Amount এবং কারণ দিন")
            with db() as con:
                target = con.execute("SELECT * FROM users WHERE id=? AND role IN ('worker','subadmin')", (int(match.group(1)),)).fetchone()
                if not target: raise ValueError("User পাওয়া যায়নি")
                award(con, target, None, "manual:" + secrets.token_hex(12), "manual_adjustment", amount, reason, user["username"])
                audit(con, user["username"], "user_balance_adjusted", "user", target["id"], {"amountPaisa": amount, "reason": reason})
            return handler.reply(201, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if path == "/api/admin/settings" and method == "GET":
        with db() as con:
            settings = {row["key"]: row["value"] for row in con.execute("SELECT key,value FROM settings WHERE key='support_whatsapp'")}
        return handler.reply(200, {"settings": settings})

    if path == "/api/admin/settings" and method == "PUT":
        try:
            data = handler.body(8192); whatsapp = digits(data.get("supportWhatsApp"))
            if whatsapp and len(whatsapp) < 10: raise ValueError("αª╕αªáαª┐αªò WhatsApp number αªªαª┐αª¿")
            with db() as con:
                con.execute("INSERT INTO settings(key,value) VALUES('support_whatsapp',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (whatsapp,))
                audit(con, user["username"], "support_settings_changed", "settings", "support")
            return handler.reply(200, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if path == "/api/admin/announcements" and method == "GET":
        with db() as con:
            rows = [dict(row) for row in con.execute("""SELECT a.*,u.full_name target_name FROM announcements a
                LEFT JOIN users u ON u.id=a.target_user_id ORDER BY a.id DESC""").fetchall()]
        return handler.reply(200, {"announcements": rows})

    if path == "/api/admin/announcements" and method == "POST":
        try:
            data = handler.body(8 * 1024 * 1024); title = str(data.get("title", "")).strip(); description = str(data.get("description", "")).strip()
            image_data = str(data.get("image", "")); target_id = int(data["targetUserId"]) if data.get("targetUserId") else None
            if not title or not description: raise ValueError("Notification title αªô description αªªαª┐αª¿")
            if image_data and not image_data.startswith("data:image/"): raise ValueError("Notification image αª╕αªáαª┐αªò αª¿αºƒ")
            with db() as con:
                cur = con.execute("INSERT INTO announcements(title,description,image_data,target_user_id,active,created_by,created_at) VALUES(?,?,?,?,1,?,?)",
                                  (title, description, image_data, target_id, user["username"], now()))
                audit(con, user["username"], "announcement_created", "announcement", cur.lastrowid)
            return handler.reply(201, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    ann_match = re.fullmatch(r"/api/admin/announcements/(\d+)", path)
    if ann_match and method == "PUT":
        with db() as con:
            con.execute("UPDATE announcements SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?", (int(ann_match.group(1)),))
            audit(con, user["username"], "announcement_toggled", "announcement", ann_match.group(1))
        return handler.reply(200, {"ok": True})

    match = re.fullmatch(r"/api/admin/users/(\d+)/detail", path)
    if match and method == "GET":
        with db() as con:
            row = con.execute("SELECT * FROM users WHERE id=? AND role='worker'", (int(match.group(1)),)).fetchone()
            if not row: return handler.reply(404,{"error":"Worker αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐"})
        files = json.loads(row["registration_json"] or "{}"); images={}
        for key,path_value in files.items():
            p=Path(path_value)
            if p.is_file() and (Path(data_dir)/"worker_registration") in p.parents:
                mime="image/png" if p.suffix.lower()==".png" else "image/jpeg"
                images[key]=f"data:{mime};base64,"+base64.b64encode(p.read_bytes()).decode()
        return handler.reply(200,{"worker":{**dict(row),"password_hash":"","salt":"","registration_json":"","images":images}})

    match = re.fullmatch(r"/api/admin/customers/(\d+)", path)
    if match and method == "GET":
        with db() as con:
            row=con.execute("""SELECT c.*,u.full_name worker_name,u.phone worker_phone,u.referral_code
                FROM customers c LEFT JOIN users u ON u.username=c.created_by WHERE c.id=?""",(int(match.group(1)),)).fetchone()
            if not row:return handler.reply(404,{"error":"Customer αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐"})
            history=[dict(r) for r in con.execute("SELECT * FROM recollections WHERE customer_id=? ORDER BY id DESC",(row["id"],))]
        return handler.reply(200,{"customer":{**dict(row),"case":json.loads(row["case_json"] or "{}"),"case_json":"","recollections":history}})

    if match and method == "PUT":
        try:
            data=handler.body(40*1024*1024); case=data.get("case")
            if not isinstance(case,dict):raise ValueError("Case details αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐")
            people=case.get("people") or [{}]; applicant=people[0]
            with db() as con:
                result=con.execute("""UPDATE customers SET case_json=?,name=?,name_bn=?,customer_number=?,phone=?,email=?,revision=revision+1,
                    reviewed_by=?,reviewed_at=? WHERE id=?""",(json.dumps(case,ensure_ascii=False),str(case.get("name","")).upper(),
                    str((case.get("details") or {}).get("nameBn","")),str(applicant.get("nid","")),
                    str((case.get("details") or {}).get("phone","")),str((case.get("details") or {}).get("email","")),
                    user["username"],now(),int(match.group(1))))
                if not result.rowcount:raise ValueError("Customer αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐")
                audit(con,user["username"],"admin_case_edited","customer",match.group(1))
            return handler.reply(200,{"ok":True})
        except Exception as error:return handler.reply(400,{"error":str(error)})

    match = re.fullmatch(r"/api/admin/users/(\d+)", path)
    if match and method == "PUT":
        try:
            data = handler.body(16384); status = str(data.get("status", "")).strip()
            if status and status not in ("approved", "rejected", "suspended"): raise ValueError("Status αª╕αªáαª┐αªò αª¿αºƒ")
            with db() as con:
                current = con.execute("SELECT * FROM users WHERE id=? AND role='worker'", (int(match.group(1)),)).fetchone()
                if not current: raise ValueError("Worker αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐")
                values = {
                    "full_name": str(data.get("fullName", current["full_name"])).strip(), "phone": digits(data.get("phone", current["phone"])),
                    "email": str(data.get("email", current["email"])).strip(), "address": str(data.get("address", current["address"])).strip(),
                    "nid_number": digits(data.get("nidNumber", current["nid_number"])), "payout_account_name": str(data.get("accountName", current["payout_account_name"])).strip(),
                    "payout_account_number": digits(data.get("accountNumber", current["payout_account_number"])), "payout_branch": str(data.get("branch", current["payout_branch"])).strip()}
                result = con.execute("""UPDATE users SET status=?,full_name=?,phone=?,email=?,address=?,nid_number=?,nid_hash=?,nid_last4=?,
                    payout_account_name=?,payout_account_number=?,payout_branch=?,approved_by=?,approved_at=?,rejection_reason=? WHERE id=? AND role='worker'""",
                    (status or current["status"], values["full_name"], values["phone"], values["email"], values["address"], values["nid_number"],
                     blind_index(data_dir, values["nid_number"]), values["nid_number"][-4:], values["payout_account_name"], values["payout_account_number"], values["payout_branch"],
                     user["username"], now() if status == "approved" else current["approved_at"], str(data.get("reason", current["rejection_reason"]))[:500], int(match.group(1))))
                if not result.rowcount: raise ValueError("Worker αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐")
                audit(con, user["username"], "worker_" + (status or "profile_edited"), "user", match.group(1), {"fields": list(data)})
            return handler.reply(200, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    match = re.fullmatch(r"/api/admin/customers/(\d+)/review", path)
    if match and method == "PUT":
        try:
            customer_id = int(match.group(1)); data = handler.body(16384); action = str(data.get("action", ""))
            statuses = {"approve": "data_approved", "correction": "correction_required", "processing": "bank_processing", "complete": "completed", "reject": "rejected"}
            if action not in statuses: raise ValueError("Review action αª╕αªáαª┐αªò αª¿αºƒ")
            with db() as con:
                row = con.execute("SELECT created_by,workflow_status FROM customers WHERE id=?", (customer_id,)).fetchone()
                if not row: raise ValueError("Customer αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐")
                worker = con.execute("SELECT * FROM users WHERE username=?", (row["created_by"],)).fetchone()
                account = digits(data.get("accountNumber"))
                if action == "complete" and len(account) < 8: raise ValueError("City Bank account number αªªαª┐αª¿")
                con.execute("UPDATE customers SET workflow_status=?,correction_note=?,bank_account_number=CASE WHEN ?!='' THEN ? ELSE bank_account_number END,data_approved_at=CASE WHEN ?='approve' THEN ? ELSE data_approved_at END,account_completed_at=CASE WHEN ?='complete' THEN ? ELSE account_completed_at END WHERE id=?",
                            (statuses[action], str(data.get("note", ""))[:1000], account, account, action, now(), action, now(), customer_id))
                if action=="correction":
                    fields=data.get("fields") or []
                    allowed_prefixes=("people.","details.","declaration.","docs.")
                    if not fields or any(not str(f).startswith(allowed_prefixes) for f in fields): raise ValueError("Recollection-αªÅαª░ αªàαª¿αºìαªñαªñ αªÅαªòαªƒαª┐ αª╕αªáαª┐αªò field αª¿αª┐αª░αºìαª¼αª╛αªÜαª¿ αªòαª░αºüαª¿")
                    con.execute("INSERT INTO recollections(customer_id,fields_json,note,status,requested_by,requested_at) VALUES(?,?,?,'requested',?,?)",
                                (customer_id,json.dumps(fields),str(data.get("note","")).strip() or "αª¿αª┐αª░αºìαª¼αª╛αªÜαª┐αªñ αªñαªÑαºìαª» αªåαª¼αª╛αª░ αª╕αªéαªùαºìαª░αª╣ αªòαª░αºüαª¿",user["username"],now()))
                    if worker: notify(con,worker["id"],"Recollection αª¬αºìαª░αºƒαºïαª£αª¿",str(data.get("note","")).strip() or "αª¿αª┐αª░αºìαª¼αª╛αªÜαª┐αªñ αªñαªÑαºìαª» αªåαª¼αª╛αª░ αª╕αªéαªùαºìαª░αª╣ αªòαª░αºüαª¿")
                if worker and action in ("approve", "complete"):
                    setting_key = "collection_reward_paisa" if action == "approve" else "completion_reward_paisa"
                    amount_row = con.execute("SELECT value FROM settings WHERE key=?", (setting_key,)).fetchone()
                    amount = int(float(amount_row[0] if amount_row else 5000)); kind = "collection_reward" if action == "approve" else "completion_reward"
                    award(con,worker,customer_id,f"{kind}:{customer_id}",kind,amount,
                          "αª╕αª«αºìαª¬αºéαª░αºìαªú data collection" if action=="approve" else "City Bank account completed",user["username"])
                    target_progress(con,worker["id"])
                audit(con, user["username"], "customer_" + action, "customer", customer_id, {"note": data.get("note", "")})
            return handler.reply(200, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    match = re.fullmatch(r"/api/admin/customers/(\d+)/bonus", path)
    if match and method == "POST":
        try:
            data = handler.body(8192); amount = round(float(data.get("amount", 0)) * 100); reason = str(data.get("reason", "")).strip()
            if amount <= 0 or not reason: raise ValueError("Bonus amount αªÅαª¼αªé αªòαª╛αª░αªú αªªαª┐αª¿")
            with db() as con:
                customer = con.execute("SELECT created_by FROM customers WHERE id=?", (int(match.group(1)),)).fetchone()
                worker = con.execute("SELECT * FROM users WHERE username=?", (customer[0],)).fetchone() if customer else None
                if not worker: raise ValueError("Worker αª¬αª╛αªôαºƒαª╛ αª»αª╛αºƒαª¿αª┐")
                award(con,worker,int(match.group(1)),"bonus:"+secrets.token_hex(12),"bonus",amount,reason,user["username"])
                audit(con, user["username"], "bonus_added", "customer", match.group(1), {"amountPaisa": amount, "reason": reason})
            return handler.reply(201, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    if path == "/api/admin/targets" and method == "GET":
        with db() as con: rows=[dict(r) for r in con.execute("""SELECT t.*,u.full_name worker_name FROM targets t
            LEFT JOIN users u ON u.id=t.user_id ORDER BY t.id DESC""")]
        return handler.reply(200,{"targets":rows})

    if path == "/api/admin/targets" and method == "POST":
        try:
            data=handler.body(8192); metric=str(data.get("metric","approved"))
            if metric not in ("approved","completed"):raise ValueError("Target metric αª╕αªáαª┐αªò αª¿αºƒ")
            required=int(data.get("requiredCount",0)); bonus=round(float(data.get("bonus",0))*100)
            if not str(data.get("name","")).strip() or required<1 or bonus<1:raise ValueError("Target name, count αªÅαª¼αªé bonus αªªαª┐αª¿")
            with db() as con:
                con.execute("""INSERT INTO targets(name,metric,required_count,bonus_paisa,starts_at,ends_at,user_id,active,created_by,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?)""",(str(data["name"]).strip(),metric,required,bonus,str(data["startsAt"]),str(data["endsAt"]),
                    int(data["userId"]) if data.get("userId") else None,1,user["username"],now()))
                audit(con,user["username"],"target_created","target","new",data)
            return handler.reply(201,{"ok":True})
        except Exception as error:return handler.reply(400,{"error":str(error)})

    match=re.fullmatch(r"/api/admin/targets/(\d+)",path)
    if match and method=="PUT":
        with db() as con:
            con.execute("UPDATE targets SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?",(int(match.group(1)),))
            audit(con,user["username"],"target_toggled","target",match.group(1))
        return handler.reply(200,{"ok":True})

    if path == "/api/admin/withdrawals" and method == "GET":
        with db() as con:
            rows = con.execute("""SELECT w.*,u.username,u.full_name,u.phone FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC""").fetchall()
        return handler.reply(200, {"withdrawals": [dict(r) for r in rows]})

    match = re.fullmatch(r"/api/admin/withdrawals/(\d+)", path)
    if match and method == "PUT":
        try:
            data = handler.body(8192); status = str(data.get("status", ""))
            if status not in ("approved", "paid", "rejected"): raise ValueError("Withdrawal status αª╕αªáαª┐αªò αª¿αºƒ")
            with db() as con:
                row = con.execute("SELECT status FROM withdrawals WHERE id=?", (int(match.group(1)),)).fetchone()
                if not row or row[0] in ("paid", "rejected"): raise ValueError("Withdrawal αªåαª░ αª¬αª░αª┐αª¼αª░αºìαªñαª¿ αªòαª░αª╛ αª»αª╛αª¼αºç αª¿αª╛")
                con.execute("UPDATE withdrawals SET status=?,reference=?,note=?,processed_at=?,processed_by=? WHERE id=?",
                            (status, str(data.get("reference", ""))[:100], str(data.get("note", ""))[:300], now(), user["username"], int(match.group(1))))
                audit(con, user["username"], "withdrawal_" + status, "withdrawal", match.group(1))
            return handler.reply(200, {"ok": True})
        except Exception as error: return handler.reply(400, {"error": str(error)})

    return False
