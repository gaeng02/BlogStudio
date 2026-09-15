import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA_VERSION = 2

CREATE_SESSIONS = """
    CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, email TEXT NOT NULL, subject TEXT NOT NULL,
        csrf TEXT NOT NULL, expires INTEGER NOT NULL
    );
"""
CREATE_DRAFTS = """
    CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, post TEXT NOT NULL,
        source_path TEXT UNIQUE, source_sha TEXT, original TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL, published_revision INTEGER, commit_sha TEXT,
        pending TEXT
    );
"""
# Asset names are content hashes, so the same image may legitimately belong to
# several drafts: the key is (draft_id, name) rather than the name alone.
CREATE_ASSETS = """
    CREATE TABLE IF NOT EXISTS assets (
        name TEXT NOT NULL, draft_id TEXT NOT NULL REFERENCES drafts(id),
        mime TEXT NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY (draft_id, name)
    );
"""
MIGRATE_V1_ASSETS = """
    BEGIN;
    CREATE TABLE assets_v2 (
        name TEXT NOT NULL, draft_id TEXT NOT NULL REFERENCES drafts(id),
        mime TEXT NOT NULL, data BLOB NOT NULL,
        PRIMARY KEY (draft_id, name)
    );
    INSERT INTO assets_v2 (name, draft_id, mime, data) SELECT name, draft_id, mime, data FROM assets;
    DROP TABLE assets;
    ALTER TABLE assets_v2 RENAME TO assets;
    PRAGMA user_version=2;
    COMMIT;
"""


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in {0, 1, SCHEMA_VERSION}:
                raise RuntimeError("Unsupported database schema version")
            if version == 1:
                db.executescript(MIGRATE_V1_ASSETS)
            db.executescript(
                CREATE_SESSIONS + CREATE_DRAFTS + CREATE_ASSETS + f"PRAGMA user_version={SCHEMA_VERSION};"
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def draft(self, draft_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (draft_id,)).fetchone()
        return self.decode(row) if row else None

    @staticmethod
    def decode(row) -> dict:
        value = dict(row)
        for key in ("post", "original", "pending"):
            value[key] = json.loads(value[key]) if value[key] else None
        return value

    def assets(self, draft_id: str) -> list:
        with self.connect() as db:
            return db.execute("SELECT * FROM assets WHERE draft_id=? ORDER BY rowid", (draft_id,)).fetchall()

    def asset(self, name: str):
        """Any draft's copy of a content-addressed image; identical names hold identical bytes."""
        with self.connect() as db:
            return db.execute("SELECT * FROM assets WHERE name=? LIMIT 1", (name,)).fetchone()
