import asyncio
import hashlib
import io
import json
import logging
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated
from urllib.parse import unquote, urlsplit

from authlib.integrations.base_client import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from .config import Settings
from .content import CATEGORY_DIRS, PostInput, category_from_path, parse_post, slug_from_path
from .db import Database
from .github import GitHub, GitHubError, article_entries
from .publishing import public_draft, publish

COOKIE = "blogstudio_session"
PREFIX = "/studio"
MAX_IMAGE = 5 * 1024 * 1024
logger = logging.getLogger(__name__)


class SaveInput(BaseModel):
    revision: int = Field(ge=1)
    post: PostInput


class RevisionInput(BaseModel):
    revision: int = Field(ge=1)


class ImportInput(BaseModel):
    path: str = Field(default="", max_length=1000)
    url: str = Field(default="", max_length=1000)


def path_date(path: str) -> str | None:
    match = re.match(r"(\d{4}-\d{2}-\d{2})-", path.rsplit("/", 1)[-1])
    return match[1] if match else None


def resolve_public_url(url: str, blog_url: str) -> tuple[str, str]:
    """Map a public article address (full URL or /category/slug) to its category and slug."""
    parts = urlsplit(url.strip())
    if parts.scheme or parts.netloc:
        blog = urlsplit(blog_url)
        if parts.scheme != blog.scheme or parts.netloc.lower() != blog.netloc.lower():
            raise HTTPException(400, f"{blog.netloc}의 글 주소만 불러올 수 있습니다.")
    segments = [unquote(segment) for segment in parts.path.strip("/").split("/") if segment]
    if len(segments) != 2 or segments[0] not in CATEGORY_DIRS or not segments[1]:
        raise HTTPException(
            400, "글 주소는 /카테고리/글주소 형식이어야 합니다. 예: /memoir/2025-03-SWMaestro"
        )
    return segments[0], segments[1]


def allowed_identity(user: dict, settings: Settings) -> bool:
    return (
        bool(user.get("sub"))
        and user.get("email_verified") is True
        and str(user.get("email", "")).lower() == settings.allowed_email
    )


def create_app(settings: Settings, github=None):
    db = Database(settings.data_dir / "studio.sqlite3")
    github = github or GitHub(settings)
    lock = asyncio.Lock()
    oauth = OAuth()
    oauth.register(
        "google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile", "code_challenge_method": "S256"},
    )

    @asynccontextmanager
    async def lifespan(app):
        # A single Uvicorn worker is intentional: serialize draft mutations and publishing.
        with db.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires < ?", (int(time.time()),))
        yield

    app = FastAPI(title="BlogStudio", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.db = db
    app.state.oauth = oauth
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="blogstudio_oauth",
        path=PREFIX,
        same_site="lax",
        https_only=settings.secure,
        max_age=600,
    )

    @app.middleware("http")
    async def headers_and_limits(request: Request, call_next):
        if (
            request.method in {"POST", "PUT", "PATCH", "DELETE"}
            and request.headers.get("origin") != settings.origin
        ):
            return JSONResponse({"detail": "허용되지 않은 요청 출처입니다."}, status_code=403)
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "잘못된 요청 크기입니다."}, status_code=400)
        if length > 6 * 1024 * 1024:
            return JSONResponse({"detail": "요청 크기가 너무 큽니다."}, status_code=413)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 6 * 1024 * 1024:
                    return JSONResponse({"detail": "요청 크기가 너무 큽니다."}, status_code=413)
            # Starlette's cached Request forwards this bounded body to the route.
            request._body = bytes(body)
        response = await call_next(request)
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' https: data: blob:; connect-src 'self'; frame-ancestors 'none'; "
            "base-uri 'self'; form-action 'self'"
        )
        return response

    @app.exception_handler(GitHubError)
    async def github_error(request, error):
        return JSONResponse({"detail": str(error)}, status_code=error.status)

    def session(request: Request):
        raw = request.cookies.get(COOKIE, "")
        with db.connect() as connection:
            found = connection.execute(
                "SELECT * FROM sessions WHERE hash=? AND expires>?",
                (
                    hashlib.sha256(raw.encode()).hexdigest(),
                    int(time.time()),
                ),
            ).fetchone()
        if not found or found["email"] != settings.allowed_email:
            raise HTTPException(401, "로그인이 필요합니다.")
        if request.method not in {"GET", "HEAD"} and not secrets.compare_digest(
            request.headers.get("x-csrf-token", ""), found["csrf"]
        ):
            raise HTTPException(403, "요청 인증이 만료되었습니다. 새로고침해 주세요.")
        return dict(found)

    @app.get(PREFIX + "/auth/login")
    async def login(request: Request):
        if not settings.google_client_id or not settings.google_client_secret:
            raise HTTPException(503, "Google 로그인 설정이 아직 완료되지 않았습니다.")
        return await oauth.google.authorize_redirect(
            request, settings.studio_url + "/auth/callback", prompt="select_account"
        )

    @app.get(PREFIX + "/auth/callback")
    async def callback(request: Request):
        try:
            token = await oauth.google.authorize_access_token(request)
            user = token.get("userinfo", {})
            if not allowed_identity(user, settings):
                request.session.clear()
                return RedirectResponse(PREFIX + "/?error=access_denied", status_code=303)
        except (OAuthError, ValueError):
            request.session.clear()
            return RedirectResponse(PREFIX + "/?error=login_failed", status_code=303)
        raw = secrets.token_urlsafe(48)
        csrf = secrets.token_urlsafe(32)
        with db.connect() as connection:
            previous = request.cookies.get(COOKIE, "")
            connection.execute(
                "DELETE FROM sessions WHERE hash=? OR expires<?",
                (hashlib.sha256(previous.encode()).hexdigest(), int(time.time())),
            )
            connection.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                (
                    hashlib.sha256(raw.encode()).hexdigest(),
                    settings.allowed_email,
                    user["sub"],
                    csrf,
                    int(time.time()) + 43200,
                ),
            )
        request.session.clear()
        response = RedirectResponse(PREFIX + "/", status_code=303)
        response.set_cookie(
            COOKIE, raw, max_age=43200, httponly=True, secure=settings.secure, samesite="lax", path=PREFIX
        )
        return response

    @app.get(PREFIX + "/api/session")
    def get_session(current: Annotated[dict, Depends(session)]):
        return {"email": current["email"], "csrf": current["csrf"], "blog_url": settings.blog_url}

    @app.post(PREFIX + "/api/logout")
    def logout(current: Annotated[dict, Depends(session)]):
        with db.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE hash=?", (current["hash"],))
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE, path=PREFIX)
        return response

    @app.get(PREFIX + "/api/drafts", dependencies=[Depends(session)])
    def list_drafts():
        with db.connect() as connection:
            rows = connection.execute("SELECT * FROM drafts ORDER BY updated_at DESC").fetchall()
        return [public_draft(db.decode(row)) for row in rows]

    @app.post(PREFIX + "/api/drafts", dependencies=[Depends(session)])
    async def new_draft(post: PostInput):
        async with lock:
            draft_id = str(uuid.uuid4())
            with db.connect() as connection:
                connection.execute(
                    "INSERT INTO drafts (id, revision, post, updated_at) VALUES (?, 1, ?, ?)",
                    (
                        draft_id,
                        post.model_dump_json(),
                        datetime.now(UTC).isoformat(),
                    ),
                )
            return public_draft(db.draft(draft_id))

    @app.get(PREFIX + "/api/drafts/{draft_id}", dependencies=[Depends(session)])
    def get_draft(draft_id: str):
        draft = db.draft(draft_id)
        if not draft:
            raise HTTPException(404, "초안을 찾지 못했습니다.")
        return public_draft(draft)

    @app.put(PREFIX + "/api/drafts/{draft_id}", dependencies=[Depends(session)])
    async def save_draft(draft_id: str, data: SaveInput):
        async with lock:
            draft = db.draft(draft_id)
            if not draft:
                raise HTTPException(404, "초안을 찾지 못했습니다.")
            if draft["pending"]:
                raise HTTPException(
                    409, "앞선 발행 결과를 확인해야 합니다. 먼저 발행 버튼을 다시 눌러 주세요."
                )
            if draft["source_path"] and any(
                data.post.model_dump(mode="json")[key] != draft["post"][key]
                for key in ("slug", "category", "date")
            ):
                raise HTTPException(400, "발행된 글의 주소, 카테고리, 최초 발행일은 유지해야 합니다.")
            if data.post.model_dump(mode="json") == draft["post"] and data.revision == draft["revision"]:
                return public_draft(draft)
            with db.connect() as connection:
                result = connection.execute(
                    "UPDATE drafts SET post=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?",
                    (
                        data.post.model_dump_json(),
                        datetime.now(UTC).isoformat(),
                        draft_id,
                        data.revision,
                    ),
                )
                if result.rowcount != 1:
                    raise HTTPException(409, "다른 창에서 초안이 바뀌었습니다. 새로 불러와 주세요.")
            return public_draft(db.draft(draft_id))

    @app.delete(PREFIX + "/api/drafts/{draft_id}", dependencies=[Depends(session)])
    async def delete_draft(draft_id: str):
        async with lock:
            draft = db.draft(draft_id)
            if not draft:
                raise HTTPException(404, "초안을 찾지 못했습니다.")
            if draft["pending"]:
                raise HTTPException(
                    409, "앞선 발행 결과를 확인해야 합니다. 발행 버튼을 다시 누른 뒤 삭제해 주세요."
                )
            # Only the private copy goes away; a published article stays on GitHub.
            with db.connect() as connection:
                connection.execute("DELETE FROM assets WHERE draft_id=?", (draft_id,))
                connection.execute("DELETE FROM drafts WHERE id=?", (draft_id,))
            return {"ok": True, "source_path": draft["source_path"]}

    @app.post(PREFIX + "/api/drafts/{draft_id}/publish", dependencies=[Depends(session)])
    async def publish_draft(draft_id: str, data: RevisionInput):
        async with lock:
            return await publish(db, github, draft_id, data.revision)

    @app.post(PREFIX + "/api/drafts/{draft_id}/reload", dependencies=[Depends(session)])
    async def reload_post(draft_id: str, data: RevisionInput):
        async with lock:
            draft = db.draft(draft_id)
            if not draft or not draft["source_path"]:
                raise HTTPException(404, "GitHub에서 불러온 글이 아닙니다.")
            if draft["revision"] != data.revision or draft["pending"]:
                raise HTTPException(409, "초안이 변경되었거나 발행 결과 확인이 필요합니다.")
            _, _, tree = await github.snapshot()
            entry = dict(article_entries(tree)).get(draft["source_path"])
            if not entry:
                raise HTTPException(409, "GitHub에서 원본이 삭제되었습니다. 현재 초안은 보존됩니다.")
            try:
                post, original = parse_post(draft["source_path"], await github.read_blob(entry["sha"]))
            except (ValueError, UnicodeError) as error:
                raise HTTPException(400, "GitHub의 글 형식을 읽을 수 없습니다.") from error
            backup = dict(draft["post"])
            backup["title"] = f"[복구용 사본] {backup['title']}"[:200]
            backup["slug"] = ""  # A backup must not accidentally publish over an existing URL.
            backup_id = str(uuid.uuid4())
            now = datetime.now(UTC).isoformat()
            # Names are content hashes, so the backup keeps the same image paths in its body.
            copied_assets = [
                (asset["name"], backup_id, asset["mime"], asset["data"]) for asset in db.assets(draft_id)
            ]
            with db.connect() as connection:
                connection.execute(
                    "INSERT INTO drafts (id,revision,post,updated_at) VALUES (?,1,?,?)",
                    (backup_id, json.dumps(backup, ensure_ascii=False), now),
                )
                connection.executemany("INSERT INTO assets VALUES (?,?,?,?)", copied_assets)
                connection.execute(
                    """UPDATE drafts SET post=?,source_sha=?,original=?,revision=revision+1,
                    published_revision=NULL,updated_at=? WHERE id=?""",
                    (
                        post.model_dump_json(),
                        entry["sha"],
                        json.dumps(original, ensure_ascii=False, default=str),
                        now,
                        draft_id,
                    ),
                )
            return {"draft": public_draft(db.draft(draft_id)), "backup": public_draft(db.draft(backup_id))}

    @app.get(PREFIX + "/api/posts", dependencies=[Depends(session)])
    async def posts(category: str = ""):
        """List published articles from the Git tree alone. Titles are read only for one
        requested category, so opening the browser never downloads every article."""
        if category and category not in CATEGORY_DIRS:
            raise HTTPException(400, "허용되지 않은 카테고리입니다.")
        _, _, tree = await github.snapshot()
        entries = [
            (path, entry)
            for path, entry in article_entries(tree)
            if not category or category_from_path(path) == category
        ]
        result = [
            {
                "path": path,
                "category": category_from_path(path),
                "slug": slug_from_path(path),
                "date": path_date(path),
                "title": None,
                "draft": None,
            }
            for path, _ in entries
        ]
        if category:
            semaphore = asyncio.Semaphore(5)

            async def load(item, entry):
                async with semaphore:
                    try:
                        post, meta = parse_post(item["path"], await github.read_blob(entry["sha"]))
                        item.update(
                            title=post.title, date=post.date.isoformat(), draft=meta.get("draft") is True
                        )
                    except (ValueError, UnicodeError):
                        item.update(error="지원하지 않는 글 형식")

            await asyncio.gather(*(load(item, entry) for item, (_, entry) in zip(result, entries)))
        return sorted(result, key=lambda item: (item.get("date") or "", item["slug"]), reverse=True)

    @app.post(PREFIX + "/api/posts/import", dependencies=[Depends(session)])
    async def import_post(data: ImportInput):
        if not data.path and not data.url:
            raise HTTPException(400, "불러올 글의 경로나 주소를 입력해 주세요.")
        async with lock:
            path = data.path
            entries = None
            if not path:
                category, slug = resolve_public_url(data.url, settings.blog_url)
                _, _, tree = await github.snapshot()
                entries = dict(article_entries(tree))
                path = next(
                    (p for p in entries if category_from_path(p) == category and slug_from_path(p) == slug),
                    None,
                )
                if not path:
                    raise HTTPException(404, "해당 주소의 글을 GitHub에서 찾지 못했습니다.")
            # Reopening an edited post resumes its draft; never discard unsaved work.
            with db.connect() as connection:
                existing = connection.execute("SELECT * FROM drafts WHERE source_path=?", (path,)).fetchone()
            if existing:
                return public_draft(db.decode(existing))
            if entries is None:
                _, _, tree = await github.snapshot()
                entries = dict(article_entries(tree))
            if path not in entries:
                raise HTTPException(404, "글을 찾지 못했습니다.")
            sha = entries[path]["sha"]
            try:
                post, meta = parse_post(path, await github.read_blob(sha))
            except (ValueError, UnicodeError) as error:
                raise HTTPException(400, "글 형식을 확인해 주세요.") from error
            draft_id = str(uuid.uuid4())
            with db.connect() as connection:
                connection.execute(
                    """INSERT INTO drafts (id, revision, post, source_path, source_sha, original, updated_at)
                    VALUES (?, 1, ?, ?, ?, ?, ?)""",
                    (
                        draft_id,
                        post.model_dump_json(),
                        path,
                        sha,
                        json.dumps(meta, ensure_ascii=False, default=str),
                        datetime.now(UTC).isoformat(),
                    ),
                )
            return public_draft(db.draft(draft_id))

    @app.post(PREFIX + "/api/drafts/{draft_id}/assets", dependencies=[Depends(session)])
    async def upload(draft_id: str, file: UploadFile):
        async with lock:
            if not db.draft(draft_id):
                raise HTTPException(404, "초안을 찾지 못했습니다.")
            data = await file.read(MAX_IMAGE + 1)
            await file.close()
            if len(data) > MAX_IMAGE:
                raise HTTPException(413, "이미지는 5MB 이하여야 합니다.")
            try:
                with Image.open(io.BytesIO(data)) as picture:
                    fmt = picture.format
                    picture.verify()
            except (
                UnidentifiedImageError,
                OSError,
                SyntaxError,
                ValueError,
                Image.DecompressionBombError,
            ) as error:
                raise HTTPException(400, "이미지 파일을 확인해 주세요.") from error
            formats = {
                "PNG": ("png", "image/png"),
                "JPEG": ("jpg", "image/jpeg"),
                "GIF": ("gif", "image/gif"),
                "WEBP": ("webp", "image/webp"),
            }
            if fmt not in formats:
                raise HTTPException(400, "PNG, JPEG, GIF, WebP 이미지를 지원합니다.")
            extension, mime = formats[fmt]
            # Content-addressed file name: re-uploading the same image yields the same
            # name, and different images cannot collide or overwrite each other.
            name = f"{hashlib.sha256(data).hexdigest()[:16]}.{extension}"
            with db.connect() as connection:
                existing = connection.execute(
                    "SELECT data FROM assets WHERE draft_id=? AND name=?", (draft_id, name)
                ).fetchone()
                if existing and existing["data"] != data:  # astronomically unlikely prefix collision
                    name = f"{hashlib.sha256(data).hexdigest()}.{extension}"
                    existing = None
                if not existing:
                    size = connection.execute(
                        "SELECT COALESCE(SUM(length(data)),0) FROM assets WHERE draft_id=?", (draft_id,)
                    ).fetchone()[0]
                    if size + len(data) > 25 * 1024 * 1024:
                        raise HTTPException(413, "초안당 이미지 합계는 25MB까지 지원합니다.")
                    connection.execute(
                        "INSERT INTO assets (name, draft_id, mime, data) VALUES (?, ?, ?, ?)",
                        (name, draft_id, mime, data),
                    )
            return {"path": f"/assets/images/{name}", "preview": PREFIX + f"/api/assets/{name}"}

    @app.get(PREFIX + "/api/assets/{name}", dependencies=[Depends(session)])
    def image(name: str):
        asset = db.asset(name)
        if not asset:
            raise HTTPException(404)
        return Response(asset["data"], media_type=asset["mime"])

    @app.get(PREFIX + "/api/drafts/{draft_id}/assets", dependencies=[Depends(session)])
    def draft_assets(draft_id: str):
        return [
            {"path": f"/assets/images/{asset['name']}", "preview": PREFIX + f"/api/assets/{asset['name']}"}
            for asset in db.assets(draft_id)
        ]

    @app.get(PREFIX + "/health")
    def health():
        return {"ok": True}

    if (settings.frontend_dir / "assets").exists():
        app.mount(PREFIX + "/assets", StaticFiles(directory=settings.frontend_dir / "assets"), name="assets")

    @app.get(PREFIX)
    def studio_redirect():
        return RedirectResponse(PREFIX + "/", status_code=307)

    @app.get(PREFIX + "/")
    def studio():
        index = settings.frontend_dir / "index.html"
        if not index.exists():
            return Response(
                "Build the frontend first: cd frontend && npm ci && npm run build", status_code=503
            )
        return FileResponse(index)

    return app


@lru_cache
def get_app():
    return create_app(Settings())
