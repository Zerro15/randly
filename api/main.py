"""Randly accounts and live shared rooms API."""
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("RANDLY_DB", "/data/randly.sqlite3")
COOKIE_SECURE = os.environ.get("RANDLY_SECURE_COOKIES", "true").lower() == "true"
COOKIE_PATH = os.environ.get("RANDLY_COOKIE_PATH", "/")
SESSION_SECONDS = 7 * 86400
HASH_ROUNDS = 300_000
USERNAME = re.compile(r"^[a-zA-Z0-9_]{3,24}$")
CODE = re.compile(r"^[A-F0-9]{10}$")
_login_failures = {}
_limiter_lock = Lock()


@contextmanager
def connect():
    connection = sqlite3.connect(DB_PATH, timeout=15)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=15000")
        with connection:
            yield connection
    finally:
        connection.close()


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS rooms (
          id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL, min_value INTEGER NOT NULL, max_value INTEGER NOT NULL,
          no_repeats INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS draws (
          id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          number INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS draws_room_id_idx ON draws(room_id,id);
        CREATE TABLE IF NOT EXISTS preferences (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          payload TEXT NOT NULL);
        """)


@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield


app = FastAPI(title="Randly API", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.middleware("http")
async def protect_requests(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        host = request.headers.get("host", "").lower()
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ("http", "https") or parsed.netloc.lower() != host:
                return JSONResponse({"detail": "Недопустимый источник запроса"}, status_code=403)
        elif request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Межсайтовые запросы запрещены"}, status_code=403)
        if not request.headers.get("content-type", "").startswith("application/json"):
            return JSONResponse({"detail": "Ожидался JSON"}, status_code=415)
    result = await call_next(request)
    if request.url.path.startswith("/api/"):
        result.headers["Cache-Control"] = "no-store"
        result.headers["X-Content-Type-Options"] = "nosniff"
    return result


def derive(password: str, salt: str):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), HASH_ROUNDS).hex()


def cookie(response, token):
    response.set_cookie("randly_session", token, max_age=SESSION_SECONDS,
                        httponly=True, secure=COOKIE_SECURE, samesite="strict", path=COOKIE_PATH)


def issue_session(db, user_id, response):
    token = secrets.token_urlsafe(36)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    db.execute("INSERT INTO sessions(hash,user_id,expires_at) VALUES (?,?,?)",
               (token_hash, user_id, int(time.time()) + SESSION_SECONDS))
    cookie(response, token)


def current_user(request: Request, db):
    token = request.cookies.get("randly_session", "")
    if not token:
        raise HTTPException(401, "Войдите в аккаунт")
    digest = hashlib.sha256(token.encode()).hexdigest()
    row = db.execute("""
        SELECT users.id,users.username FROM sessions
        JOIN users ON users.id=sessions.user_id
        WHERE sessions.hash=? AND sessions.expires_at>?
    """, (digest, int(time.time()))).fetchone()
    if row is None:
        raise HTTPException(401, "Сессия истекла")
    return row


def now():
    return int(time.time())


def timestamp(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def check_password(password):
    if len(password) < 10 or len(password) > 128:
        raise HTTPException(422, "Пароль должен содержать от 10 до 128 символов")


def validate_login(username):
    if not USERNAME.fullmatch(username):
        raise HTTPException(422, "Логин: 3–24 латинских символа, цифры или _")


class Credentials(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=128)


class RoomCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    min_value: int = Field(ge=-1000000, le=1000000)
    max_value: int = Field(ge=-1000000, le=1000000)
    no_repeats: bool = True


class PreferencesPayload(BaseModel):
    values: dict


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/register", status_code=201)
def register(data: Credentials, response: Response):
    username = data.username.strip()
    validate_login(username)
    check_password(data.password)
    salt = secrets.token_hex(16)
    with connect() as db:
        try:
            cur = db.execute("INSERT INTO users(username,salt,password_hash,created_at) VALUES(?,?,?,?)",
                             (username, salt, derive(data.password, salt), now()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Логин уже занят")
        issue_session(db, cur.lastrowid, response)
    return {"username": username}


@app.post("/api/auth/login")
def login(data: Credentials, request: Request, response: Response):
    username = data.username.strip()
    ip = request.client.host if request.client else "unknown"
    key = (ip, username.lower())
    with _limiter_lock:
        attempts = [v for v in _login_failures.get(key, []) if v > time.time() - 60]
        if len(attempts) >= 8:
            raise HTTPException(429, "Слишком много попыток, повторите через минуту")
    with connect() as db:
        row = db.execute("SELECT id,username,salt,password_hash FROM users WHERE username=? COLLATE NOCASE",
                         (username,)).fetchone()
        salt = row["salt"] if row else "0" * 32
        test = derive(data.password, salt)
        if not row or not hmac.compare_digest(test, row["password_hash"]):
            with _limiter_lock:
                _login_failures[key] = attempts + [time.time()]
            raise HTTPException(401, "Неверный логин или пароль")
        with _limiter_lock:
            _login_failures.pop(key, None)
        issue_session(db, row["id"], response)
        return {"username": row["username"]}


@app.get("/api/auth/me")
def me(request: Request):
    with connect() as db:
        user = current_user(request, db)
        return {"username": user["username"]}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("randly_session")
    if token:
        with connect() as db:
            db.execute("DELETE FROM sessions WHERE hash=?",
                       (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie("randly_session", path=COOKIE_PATH, secure=COOKIE_SECURE, samesite="strict")
    return {"ok": True}


@app.get("/api/me/preferences")
def get_preferences(request: Request):
    with connect() as db:
        user = current_user(request, db)
        row = db.execute("SELECT payload FROM preferences WHERE user_id=?", (user["id"],)).fetchone()
        return {"values": json.loads(row["payload"]) if row else {}}


@app.put("/api/me/preferences")
def set_preferences(data: PreferencesPayload, request: Request):
    value = json.dumps(data.values, ensure_ascii=False)
    if len(value.encode("utf-8")) > 65536:
        raise HTTPException(413, "Данные превышают 64 КБ")
    with connect() as db:
        user = current_user(request, db)
        db.execute("INSERT INTO preferences(user_id,payload) VALUES(?,?) "
                   "ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload", (user["id"], value))
    return {"ok": True}


def serialize_room(db, row, viewer_id=None):
    entries = db.execute("SELECT id,number,created_at FROM draws WHERE room_id=? ORDER BY id DESC LIMIT 30",
                         (row["id"],)).fetchall()
    return {"code": row["code"], "title": row["title"], "min": row["min_value"],
            "max": row["max_value"], "no_repeats": bool(row["no_repeats"]),
            "host": row["username"], "is_host": viewer_id == row["owner_id"],
            "history": [{"id": x["id"], "number": x["number"], "at": timestamp(x["created_at"])} for x in entries],
            "latest": entries[0]["number"] if entries else None}


def room_record(db, code):
    if not CODE.fullmatch(code):
        raise HTTPException(404, "Комната не найдена")
    row = db.execute("""
        SELECT rooms.*,users.username FROM rooms JOIN users ON users.id=rooms.owner_id
        WHERE rooms.code=?""", (code,)).fetchone()
    if not row:
        raise HTTPException(404, "Комната не найдена")
    return row


@app.post("/api/rooms", status_code=201)
def create_room(data: RoomCreate, request: Request):
    title = data.title.strip()
    if not title:
        raise HTTPException(422, "Введите название")
    if data.min_value > data.max_value or data.max_value - data.min_value + 1 > 1000:
        raise HTTPException(422, "Диапазон должен содержать от 1 до 1000 чисел")
    with connect() as db:
        owner = current_user(request, db)
        count = db.execute("SELECT count(*) FROM rooms WHERE owner_id=?", (owner["id"],)).fetchone()[0]
        if count >= 25:
            raise HTTPException(409, "Максимум 25 комнат на аккаунт")
        for _ in range(5):
            code = secrets.token_hex(5).upper()
            try:
                db.execute("INSERT INTO rooms(code,owner_id,title,min_value,max_value,no_repeats,created_at) "
                           "VALUES(?,?,?,?,?,?,?)",
                           (code, owner["id"], title, data.min_value, data.max_value,
                            int(data.no_repeats), now()))
                return {"code": code}
            except sqlite3.IntegrityError:
                pass
    raise HTTPException(503, "Не удалось создать комнату")


@app.get("/api/me/rooms")
def my_rooms(request: Request):
    with connect() as db:
        user = current_user(request, db)
        rows = db.execute("SELECT code,title FROM rooms WHERE owner_id=? ORDER BY id DESC LIMIT 25",
                          (user["id"],)).fetchall()
        return {"rooms": [dict(x) for x in rows]}


@app.get("/api/rooms/{code}")
def get_room(code: str, request: Request):
    code = code.upper()
    with connect() as db:
        row = room_record(db, code)
        viewer_id = None
        try:
            viewer_id = current_user(request, db)["id"]
        except HTTPException:
            pass
        return serialize_room(db, row, viewer_id)


@app.post("/api/rooms/{code}/draw")
def draw(code: str, request: Request):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = room_record(db, code.upper())
        user = current_user(request, db)
        if user["id"] != row["owner_id"]:
            raise HTTPException(403, "Только организатор может запускать жеребьёвку")
        lo, hi = row["min_value"], row["max_value"]
        if row["no_repeats"]:
            used = {r[0] for r in db.execute("SELECT number FROM draws WHERE room_id=?", (row["id"],))}
            pool = [n for n in range(lo, hi + 1) if n not in used]
            if not pool:
                raise HTTPException(409, "Все числа выпали. Сбросьте историю")
            value = secrets.choice(pool)
        else:
            value = lo + secrets.randbelow(hi - lo + 1)
        db.execute("INSERT INTO draws(room_id,number,created_at) VALUES (?,?,?)", (row["id"], value, now()))
        return {"number": value}


@app.post("/api/rooms/{code}/reset")
def reset_room(code: str, request: Request):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = room_record(db, code.upper())
        user = current_user(request, db)
        if row["owner_id"] != user["id"]:
            raise HTTPException(403, "Только организатор может сбросить историю")
        db.execute("DELETE FROM draws WHERE room_id=?", (row["id"],))
    return {"ok": True}


@app.get("/api/rooms/{code}/qr")
def room_qr(code: str, url: str, request: Request):
    with connect() as db:
        room_record(db, code.upper())
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or parsed.netloc.lower() != request.headers.get("host", "").lower():
        raise HTTPException(400, "Некорректная ссылка")
    if not parsed.path.endswith("/room.html") or parsed.query != "code=" + code.upper():
        raise HTTPException(400, "Ссылка не соответствует комнате")
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage,
                        box_size=8, border=2)
    output = io.BytesIO()
    image.save(output)
    return Response(output.getvalue(), media_type="image/svg+xml",
                    headers={"Cache-Control": "no-store", "Content-Security-Policy": "sandbox"})
