from pathlib import Path
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)
    studio_url: str = "http://localhost:8000/studio"
    blog_url: str = "https://www.gaeng02.com"
    allowed_email: str = "sondin144@gmail.com"
    session_secret: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    github_owner: str = "gaeng02"
    github_repo: str = "gaeng02.github.io"
    github_branch: str = "main"
    github_token: str = ""
    data_dir: Path = Path("data")
    frontend_dir: Path = Path("frontend/dist")

    @model_validator(mode="after")
    def validate_settings(self):
        url = urlsplit(self.studio_url)
        if url.path.rstrip("/") != "/studio" or url.query or url.fragment or url.username:
            raise ValueError("STUDIO_URL must end in /studio, without query parameters")
        if url.scheme != "https" and not (
            url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1"}
        ):
            raise ValueError("STUDIO_URL requires HTTPS outside localhost")
        if len(self.session_secret) < 32:
            raise ValueError("SESSION_SECRET must contain at least 32 random characters")
        if not self.allowed_email or "@" not in self.allowed_email:
            raise ValueError("ALLOWED_EMAIL is required")
        self.allowed_email = self.allowed_email.strip().lower()
        self.studio_url = self.studio_url.rstrip("/")
        self.blog_url = self.blog_url.rstrip("/")
        return self

    @property
    def origin(self) -> str:
        url = urlsplit(self.studio_url)
        return f"{url.scheme}://{url.netloc}"

    @property
    def secure(self) -> bool:
        return self.studio_url.startswith("https://")
