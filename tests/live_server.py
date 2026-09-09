"""Browser-test fixture only. Uses an ephemeral DB and a fake GitHub repository."""

import hashlib
import os
import sys
import tempfile
import time
from pathlib import Path

import uvicorn

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
os.chdir(root)

from app.config import Settings
from app.main import create_app
from tests.test_studio import FakeGitHub

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="blogstudio-browser-") as directory:
        settings = Settings(
            _env_file=None,
            studio_url="http://127.0.0.1:4180/studio",
            session_secret="browser-test-secret-" * 3,
            data_dir=Path(directory),
        )
        app = create_app(settings, FakeGitHub())
        with app.state.db.connect() as connection:
            connection.execute(
                "INSERT INTO sessions VALUES (?,?,?,?,?)",
                (
                    hashlib.sha256(b"browser-test-session").hexdigest(),
                    settings.allowed_email,
                    "browser-google-subject",
                    "browser-csrf",
                    int(time.time()) + 3600,
                ),
            )
        uvicorn.run(app, host="127.0.0.1", port=4180, access_log=False)
