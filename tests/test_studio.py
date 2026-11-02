import base64
import hashlib
import io
import re
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.content import parse_post
from app.github import GitHub, GitHubError, blob_sha
from app.main import COOKIE, allowed_identity, create_app

PATH = "content/memoir/2025-03-SWMaestro.md"
URL = "https://www.gaeng02.com/memoir/2025-03-SWMaestro"
SOURCE = """---
title: 기존 글
date: "2025-03-31"
category: memoir
description: 원본 설명
tags: ["쉼표, 있는 태그", "인용문"]
custom: keep-me
---

기존 본문
"""


class FakeGitHub:
    def __init__(self):
        self.files = {PATH: SOURCE.encode()}
        self.head = "initial"
        self.commits = {}
        self.applied_commits = set()
        self.advance_count = 0
        self.lose_response = False
        self.move_before_advance = False
        self.blobs = {blob_sha(data): data for data in self.files.values()}
        self.calls = []

    def add_file(self, path, data):
        self.files[path] = data
        self.blobs[blob_sha(data)] = data

    def tree(self):
        return {
            path: {"sha": blob_sha(data), "type": "blob", "mode": "100644"}
            for path, data in self.files.items()
        }

    async def snapshot(self):
        self.calls.append("snapshot")
        return self.head, "tree", self.tree()

    async def branch_files(self):
        self.calls.append("branch_files")
        return self.tree()

    async def read_blob(self, sha):
        self.calls.append("read_blob")
        return self.blobs[sha].decode()

    async def close(self):
        pass

    async def create_commit(self, head, tree, files, title):
        sha = f"commit-{len(self.commits)}"
        self.commits[sha] = {"parent": head, "files": files}
        return {"sha": sha}

    async def advance(self, sha):
        if self.move_before_advance:
            self.head = "external-change"
            self.move_before_advance = False
        if self.commits[sha]["parent"] != self.head:
            raise GitHubError("concurrent commit", 409)
        self.files.update(self.commits[sha]["files"])
        self.blobs.update({blob_sha(data): data for data in self.files.values()})
        self.head = sha
        self.applied_commits.add(sha)
        self.advance_count += 1
        if self.lose_response:
            self.lose_response = False
            raise GitHubError("lost response")

    async def applied(self, sha, head):
        return sha in self.applied_commits


@pytest.fixture
def setup(tmp_path):
    settings = Settings(_env_file=None, session_secret="s" * 48, data_dir=tmp_path)
    github = FakeGitHub()
    app = create_app(settings, github)
    with TestClient(app, base_url="http://localhost:8000") as client:
        yield client, app.state.db, github, settings


def login(client, db, email="sondin144@gmail.com", expires=None):
    token = "test-session"
    with db.connect() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?)",
            (
                hashlib.sha256(token.encode()).hexdigest(),
                email,
                "google-sub",
                "test-csrf",
                expires or int(time.time()) + 1000,
            ),
        )
    client.cookies.set(COOKIE, token, path="/studio")
    client.headers.update({"origin": "http://localhost:8000", "x-csrf-token": "test-csrf"})


def new_post():
    return {
        "title": "새 글",
        "slug": "새-글",
        "category": "try-tech",
        "date": "2025-04-01",
        "description": "검색 설명",
        "body": "## 본문\n내용",
        "tags": ['따옴표"', "쉼표, 태그"],
        "cover": "",
    }


def test_private_routes_and_csrf(setup):
    client, db, _, _ = setup
    assert client.get("/studio/api/drafts").status_code == 401
    assert client.get("/studio/api/assets/file.png").status_code == 401
    assert client.post("/studio/api/drafts", json=new_post()).status_code == 403
    login(client, db)
    client.headers["origin"] = "https://attacker.example"
    assert client.post("/studio/api/drafts", json=new_post()).status_code == 403
    client.headers["origin"] = "http://localhost:8000"
    client.headers["x-csrf-token"] = "bad"
    assert client.post("/studio/api/drafts", json=new_post()).status_code == 403
    login(client, db, email="other@gmail.com")
    assert client.get("/studio/api/drafts").status_code == 401
    login(client, db, expires=1)
    assert client.get("/studio/api/session").status_code == 401


def test_identity_is_verified_and_allowlisted(setup):
    _, _, _, settings = setup
    assert allowed_identity({"sub": "1", "email": settings.allowed_email, "email_verified": True}, settings)
    assert not allowed_identity(
        {"sub": "1", "email": settings.allowed_email, "email_verified": False}, settings
    )
    assert not allowed_identity({"sub": "1", "email": "other@gmail.com", "email_verified": True}, settings)
    assert not allowed_identity({"email": settings.allowed_email, "email_verified": True}, settings)


def test_oauth_rejects_missing_state_and_does_not_create_session(setup):
    client, db, _, _ = setup
    response = client.get("/studio/auth/callback?code=fake&state=unrecognized", follow_redirects=False)
    assert response.status_code == 303
    assert "login_failed" in response.headers["location"]
    with db.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_local_conflict_and_persistent_draft(setup):
    client, db, _, _ = setup
    login(client, db)
    draft = client.post("/studio/api/drafts", json=new_post()).json()
    changed = {**draft["post"], "body": "수정 본문"}
    assert (
        client.put(f"/studio/api/drafts/{draft['id']}", json={"revision": 1, "post": changed}).status_code
        == 200
    )
    assert (
        client.put(f"/studio/api/drafts/{draft['id']}", json={"revision": 1, "post": new_post()}).status_code
        == 409
    )
    assert db.draft(draft["id"])["post"]["body"] == "수정 본문"
    from app.db import Database

    assert Database(db.path).draft(draft["id"])["revision"] == 2


def test_edit_preserves_url_date_custom_fields_and_detects_remote_changes(setup):
    client, db, github, _ = setup
    login(client, db)
    draft = client.post("/studio/api/posts/import", json={"url": URL}).json()
    assert draft["post"]["slug"] == "2025-03-SWMaestro"
    assert (
        client.put(
            f"/studio/api/drafts/{draft['id']}",
            json={"revision": 1, "post": {**draft["post"], "slug": "changed"}},
        ).status_code
        == 400
    )
    changed = {**draft["post"], "title": "수정한 제목", "body": "수정된 본문"}
    saved = client.put(f"/studio/api/drafts/{draft['id']}", json={"revision": 1, "post": changed}).json()
    reopened = client.post("/studio/api/posts/import", json={"url": URL}).json()
    assert reopened["id"] == saved["id"] and reopened["post"]["body"] == "수정된 본문"
    response = client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": saved["revision"]})
    assert response.status_code == 200, response.text
    post, meta = parse_post(PATH, github.files[PATH].decode())
    assert post.title == "수정한 제목" and str(post.date) == "2025-03-31"
    assert meta["custom"] == "keep-me" and meta["updatedAt"]
    assert len(github.files) == 1
    latest = response.json()
    saved = client.put(
        f"/studio/api/drafts/{draft['id']}",
        json={"revision": latest["revision"], "post": {**latest["post"], "body": "두 번째 수정"}},
    ).json()
    github.files[PATH] = b"external edit"
    assert (
        client.post(
            f"/studio/api/drafts/{draft['id']}/publish", json={"revision": saved["revision"]}
        ).status_code
        == 409
    )
    assert github.files[PATH] == b"external edit"


def test_images_and_post_are_one_commit_with_timeout_recovery(setup):
    client, db, github, _ = setup
    login(client, db)
    draft = client.post("/studio/api/drafts", json=new_post()).json()
    buffer = io.BytesIO()
    Image.new("RGB", (3, 3)).save(buffer, "PNG")
    uploaded = client.post(
        f"/studio/api/drafts/{draft['id']}/assets",
        files={"file": ("fake.html", buffer.getvalue(), "text/html")},
    )
    assert uploaded.status_code == 200
    asset = uploaded.json()
    assert asset["path"].endswith(".png")
    assert client.get(asset["preview"]).headers["content-type"] == "image/png"
    github.lose_response = True
    assert client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1}).status_code == 502
    assert db.draft(draft["id"])["pending"]
    response = client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1})
    assert response.status_code == 200
    assert github.advance_count == 1
    assert "public" + asset["path"] in github.files
    assert client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1}).status_code == 200
    assert github.advance_count == 1
    assert (
        client.post(
            f"/studio/api/drafts/{draft['id']}/assets",
            files={"file": ("x.svg", b"<svg><script>alert(1)</script></svg>", "image/svg+xml")},
        ).status_code
        == 400
    )


def test_concurrent_remote_commit_never_forces_overwrite(setup):
    client, db, github, _ = setup
    login(client, db)
    draft = client.post("/studio/api/drafts", json=new_post()).json()
    github.move_before_advance = True
    assert client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1}).status_code == 409
    assert github.head == "external-change"
    assert client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1}).status_code == 200
    assert github.advance_count == 1


def test_duplicate_url_rejected_even_with_different_date(setup):
    client, db, github, _ = setup
    login(client, db)
    post = {**new_post(), "slug": "2025-03-SWMaestro", "category": "memoir"}
    draft = client.post("/studio/api/drafts", json=post).json()
    assert client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1}).status_code == 409
    assert github.advance_count == 0


def test_input_limits_paths_headers_and_logout(setup):
    client, db, _, _ = setup
    login(client, db)
    for slug in ["../../etc/passwd", "/absolute", "a/b", "x?y", "x#y", "<script>"]:
        assert client.post("/studio/api/drafts", json={**new_post(), "slug": slug}).status_code == 422
    assert (
        client.post("/studio/api/posts/import", json={"url": "/.github/workflows/deploy.yml"}).status_code
        == 400
    )
    response = client.get("/studio/api/drafts")
    assert "no-store" in response.headers["cache-control"]
    assert "noindex" in response.headers["x-robots-tag"]
    assert client.post("/studio/api/drafts", content=b"x" * (6 * 1024 * 1024 + 1)).status_code == 413
    assert client.post("/studio/api/logout").status_code == 200
    assert client.get("/studio/api/drafts").status_code == 401


def test_github_transport_writes_correct_atomic_tree(monkeypatch, setup):
    import asyncio

    import httpx

    _, _, _, settings = setup
    settings.github_token = "test-token"
    requests = []

    def handle(request):
        import json

        payload = json.loads(request.content) if request.content else {}
        requests.append((request.url.path, payload))
        if request.url.path.endswith("/blobs"):
            return httpx.Response(201, json={"sha": blob_sha(base64.b64decode(payload["content"]))})
        if request.url.path.endswith("/trees"):
            return httpx.Response(201, json={"sha": "new-tree"})
        if request.url.path.endswith("/commits"):
            return httpx.Response(201, json={"sha": "new-commit"})
        return httpx.Response(200, json={"object": {"sha": "new-commit"}})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    github = GitHub(settings)

    async def execute():
        await github.create_commit(
            "parent", "base", {PATH: SOURCE.encode(), "public/assets/images/a.png": b"image"}, "제목"
        )
        await github.advance("new-commit")
        await github.close()

    asyncio.run(execute())
    tree = next(payload for path, payload in requests if path.endswith("/trees"))
    assert tree["base_tree"] == "base" and len(tree["tree"]) == 2
    assert requests[-1][1] == {"sha": "new-commit", "force": False}


def test_github_transport_reuses_one_client_and_reads_the_branch_in_two_calls(monkeypatch, setup):
    import asyncio

    import httpx

    _, _, _, settings = setup
    settings.github_token = "test-token"
    requests = []
    clients = []

    def handle(request):
        requests.append(request.url.raw_path.decode().split("/gaeng02.github.io", 1)[1])
        if request.url.path.endswith("/branches/main"):
            return httpx.Response(200, json={"commit": {"sha": "head", "commit": {"tree": {"sha": "root"}}}})
        entry = {"path": PATH, "sha": "blob", "type": "blob", "mode": "100644"}
        return httpx.Response(200, json={"sha": "root", "truncated": False, "tree": [entry]})

    original_client = httpx.AsyncClient

    def client(**kwargs):
        clients.append(original_client(transport=httpx.MockTransport(handle), **kwargs))
        return clients[-1]

    monkeypatch.setattr(httpx, "AsyncClient", client)
    github = GitHub(settings)

    async def execute():
        head, tree_sha, files = await github.snapshot()
        assert (head, tree_sha, list(files)) == ("head", "root", [PATH])
        assert list(await github.branch_files()) == [PATH]
        await github.close()

    asyncio.run(execute())
    assert requests == ["/branches/main", "/git/trees/root?recursive=1", "/git/trees/main?recursive=1"]
    assert len(clients) == 1 and clients[0].is_closed


def test_reload_preserves_a_backup_and_its_images(setup):
    client, db, github, _ = setup
    login(client, db)
    draft = client.post("/studio/api/posts/import", json={"url": URL}).json()
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buffer, "PNG")
    asset = client.post(
        f"/studio/api/drafts/{draft['id']}/assets", files={"file": ("a.png", buffer.getvalue(), "image/png")}
    ).json()
    changed = {**draft["post"], "body": f"내 수정 ![image]({asset['path']})", "cover": asset["path"]}
    saved = client.put(f"/studio/api/drafts/{draft['id']}", json={"revision": 1, "post": changed}).json()
    external = SOURCE.replace("기존 본문", "외부에서 수정한 본문").encode()
    github.files[PATH] = external
    github.blobs[blob_sha(external)] = external
    response = client.post(f"/studio/api/drafts/{draft['id']}/reload", json={"revision": saved["revision"]})
    assert response.status_code == 200, response.text
    result = response.json()
    assert "외부에서 수정한 본문" in result["draft"]["post"]["body"]
    backup = result["backup"]
    assert "내 수정" in backup["post"]["body"] and backup["post"]["slug"] == ""
    images = client.get(f"/studio/api/drafts/{backup['id']}/assets").json()
    assert len(images) == 1 and images[0]["path"] in backup["post"]["body"]
    assert backup["post"]["cover"] == images[0]["path"]
    assert client.get(images[0]["preview"]).content == buffer.getvalue()


def test_google_callback_creates_only_allowed_sessions(monkeypatch, setup):
    client, _, _, settings = setup
    user = {"sub": "google-user", "email": "other@gmail.com", "email_verified": True}

    async def verified_token(request):
        return {"userinfo": user, "access_token": "must-never-reach-browser"}

    monkeypatch.setattr(client.app.state.oauth.google, "authorize_access_token", verified_token)
    response = client.get("/studio/auth/callback", follow_redirects=False)
    assert "access_denied" in response.headers["location"]
    assert client.get("/studio/api/session").status_code == 401
    user["email"] = settings.allowed_email
    response = client.get("/studio/auth/callback", follow_redirects=False)
    assert response.status_code == 303
    assert "HttpOnly" in response.headers["set-cookie"] and "Path=/studio" in response.headers["set-cookie"]
    assert "must-never-reach-browser" not in response.headers["set-cookie"]
    current = client.get("/studio/api/session")
    assert current.status_code == 200 and current.json()["email"] == settings.allowed_email


def png_bytes(color="red"):
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), color).save(buffer, "PNG")
    return buffer.getvalue()


def test_delete_draft_removes_private_copy_and_images(setup):
    client, db, github, _ = setup
    login(client, db)
    draft = client.post("/studio/api/drafts", json=new_post()).json()
    asset = client.post(
        f"/studio/api/drafts/{draft['id']}/assets", files={"file": ("a.png", png_bytes(), "image/png")}
    ).json()
    assert client.get(asset["preview"]).status_code == 200
    assert client.delete(f"/studio/api/drafts/{draft['id']}").status_code == 200
    assert client.get(f"/studio/api/drafts/{draft['id']}").status_code == 404
    assert client.get(asset["preview"]).status_code == 404
    assert client.delete(f"/studio/api/drafts/{draft['id']}").status_code == 404
    # Deleting the working copy of a published article never touches GitHub.
    imported = client.post("/studio/api/posts/import", json={"url": URL}).json()
    assert client.delete(f"/studio/api/drafts/{imported['id']}").json()["source_path"] == PATH
    assert PATH in github.files
    assert client.post("/studio/api/posts/import", json={"url": URL}).json()["id"] != imported["id"]
    # A publish whose outcome is still unknown must be confirmed before deletion.
    draft = client.post("/studio/api/drafts", json=new_post()).json()
    github.lose_response = True
    assert client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1}).status_code == 502
    assert client.delete(f"/studio/api/drafts/{draft['id']}").status_code == 409
    assert client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": 1}).status_code == 200
    assert client.delete(f"/studio/api/drafts/{draft['id']}").status_code == 200


def test_import_by_public_url(setup):
    client, db, github, _ = setup
    login(client, db)
    draft = client.post("/studio/api/posts/import", json={"url": URL}).json()
    assert draft["source_path"] == PATH
    # Opening by link reads the branch's file list and that one article: no commit snapshot.
    assert github.calls == ["branch_files", "read_blob"]
    for same in ["/memoir/2025-03-SWMaestro/", URL + "#1-지원서-검토", URL + "?from=search"]:
        assert client.post("/studio/api/posts/import", json={"url": same}).json()["id"] == draft["id"]
    # A post already being edited reopens from its draft without asking GitHub.
    assert github.calls == ["branch_files", "read_blob"]
    github.calls.clear()
    changed = {**draft["post"], "body": "고친 본문"}
    saved = client.put(f"/studio/api/drafts/{draft['id']}", json={"revision": 1, "post": changed}).json()
    published = client.post(f"/studio/api/drafts/{draft['id']}/publish", json={"revision": saved["revision"]})
    assert published.status_code == 200, published.text
    assert github.calls == ["snapshot"]  # publishing still checks the latest commit
    github.add_file("content/try-tech/2025-04-01-새-글.md", SOURCE.replace("memoir", "try-tech").encode())
    korean = client.post(
        "/studio/api/posts/import", json={"url": "https://www.gaeng02.com/try-tech/%EC%83%88-%EA%B8%80"}
    )
    assert korean.status_code == 200, korean.text
    assert korean.json()["source_path"] == "content/try-tech/2025-04-01-새-글.md"
    for url, status in [
        ("https://evil.example/memoir/2025-03-SWMaestro", 400),
        ("http://www.gaeng02.com/memoir/2025-03-SWMaestro", 400),
        ("https://www.gaeng02.com/memoir/missing", 404),
        ("https://www.gaeng02.com/about", 400),
        ("https://www.gaeng02.com/admin/../memoir/2025-03-SWMaestro", 400),
    ]:
        assert client.post("/studio/api/posts/import", json={"url": url}).status_code == status, url
    assert client.post("/studio/api/posts/import", json={}).status_code == 400


def test_image_names_are_content_hashes_shared_across_drafts(setup):
    client, db, _, _ = setup
    login(client, db)
    first = client.post("/studio/api/drafts", json=new_post()).json()
    second = client.post("/studio/api/drafts", json={**new_post(), "slug": "second"}).json()
    data = png_bytes()
    expected = f"/assets/images/{hashlib.sha256(data).hexdigest()[:16]}.png"
    uploads = [
        client.post(
            f"/studio/api/drafts/{first['id']}/assets", files={"file": ("사진 1.PNG", data, "image/png")}
        ),
        client.post(
            f"/studio/api/drafts/{first['id']}/assets", files={"file": ("again.png", data, "image/png")}
        ),
        client.post(
            f"/studio/api/drafts/{second['id']}/assets", files={"file": ("copy.png", data, "image/png")}
        ),
    ]
    assert all(response.status_code == 200 for response in uploads)
    assert {response.json()["path"] for response in uploads} == {expected}
    assert len(client.get(f"/studio/api/drafts/{first['id']}/assets").json()) == 1
    assert len(client.get(f"/studio/api/drafts/{second['id']}/assets").json()) == 1
    other = client.post(
        f"/studio/api/drafts/{first['id']}/assets", files={"file": ("b.png", png_bytes("blue"), "image/png")}
    ).json()
    assert other["path"] != expected and re.fullmatch(r"/assets/images/[0-9a-f]{16}\.png", other["path"])
    assert client.get(uploads[0].json()["preview"]).content == data


def test_version_1_database_migrates_assets_to_composite_key(tmp_path):
    from app.db import Database

    path = tmp_path / "studio.sqlite3"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, subject TEXT NOT NULL,
            csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE drafts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, post TEXT NOT NULL,
            source_path TEXT UNIQUE, source_sha TEXT, original TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL, published_revision INTEGER, commit_sha TEXT, pending TEXT);
        CREATE TABLE assets (name TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id),
            mime TEXT NOT NULL, data BLOB NOT NULL);
        INSERT INTO drafts (id, revision, post, updated_at) VALUES ('a', 1, '{}', 'now'), ('b', 1, '{}', 'now');
        INSERT INTO assets VALUES ('studio-old.png', 'a', 'image/png', X'00');
        PRAGMA user_version=1;
    """)
    old.close()
    db = Database(path)
    with db.connect() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
        assert [row["name"] for row in connection.execute("SELECT name FROM assets")] == ["studio-old.png"]
        connection.execute(
            "INSERT INTO assets (name, draft_id, mime, data) VALUES ('studio-old.png', 'b', 'image/png', X'00')"
        )
    assert len(db.assets("b")) == 1 and db.asset("studio-old.png")["draft_id"] == "a"
    assert Database(path).asset("studio-old.png") is not None
