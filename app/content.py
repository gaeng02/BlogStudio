import re
from datetime import date as Date
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

CATEGORY_DIRS = {"book": "book-reviews", "paper": "paper-reviews", "try-tech": "try-tech", "memoir": "memoir"}
KST = timezone(timedelta(hours=9))


class PostInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Literal["book", "paper", "try-tech", "memoir"] = "try-tech"
    title: str = Field(default="", max_length=200)
    slug: str = Field(default="", max_length=120)
    date: Date = Field(default_factory=lambda: datetime.now(KST).date())
    description: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=30)
    cover: str = Field(default="", max_length=2000)
    body: str = Field(default="", max_length=500_000)

    @field_validator("slug")
    @classmethod
    def valid_slug(cls, value):
        if value and not re.fullmatch(r"[^\W_][\w-]*", value, re.UNICODE):
            raise ValueError("주소에는 문자, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.")
        return value

    @field_validator("tags")
    @classmethod
    def valid_tags(cls, tags):
        if any(len(tag) > 80 for tag in tags):
            raise ValueError("태그는 80자 이내여야 합니다.")
        return list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))

    @field_validator("cover")
    @classmethod
    def valid_cover(cls, value):
        if value and not value.startswith(("https://", "/assets/images/")):
            raise ValueError("표지는 HTTPS 주소 또는 /assets/images/ 경로여야 합니다.")
        return value


def slug_from_path(path: str) -> str:
    return re.sub(r"^\d{4}-\d{2}-\d{2}-", "", PurePosixPath(path).stem)


def category_from_path(path: str) -> str:
    parts = PurePosixPath(path).parts
    if ".." in parts or len(parts) < 3 or parts[0] != "content" or not path.endswith(".md"):
        raise ValueError("허용되지 않은 글 경로입니다.")
    for category, directory in CATEGORY_DIRS.items():
        if parts[1] == directory:
            return category
    raise ValueError("허용되지 않은 카테고리입니다.")


def parse_post(path: str, text: str) -> tuple[PostInput, dict]:
    category = category_from_path(path)
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)(.*)\Z", text, re.DOTALL)
    if not match:
        raise ValueError("글의 frontmatter를 읽을 수 없습니다.")
    meta = yaml.safe_load(match[1])
    if not isinstance(meta, dict) or meta.get("category") != category:
        raise ValueError("글의 카테고리와 폴더가 일치하지 않습니다.")
    post = PostInput.model_validate(
        {
            **{key: meta[key] for key in PostInput.model_fields if key in meta},
            "slug": slug_from_path(path),
            "body": match[2].lstrip("\r\n"),
        }
    )
    # Preserve custom fields when editing an existing article.
    return post, meta


def post_path(post: PostInput) -> str:
    return f"content/{CATEGORY_DIRS[post.category]}/{post.date.isoformat()}-{post.slug}.md"


def serialize_post(post: PostInput, original: dict, updated_at: str) -> str:
    meta = {**original, **post.model_dump(mode="json", exclude={"body", "slug"}), "updatedAt": updated_at}
    meta.pop("draft", None)
    if not meta["cover"]:
        meta.pop("cover")
    return (
        "---\n"
        + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
        + "\n---\n\n"
        + post.body.rstrip()
        + "\n"
    )
