import json
from datetime import UTC, datetime

from fastapi import HTTPException

from .content import KST, PostInput, category_from_path, post_path, serialize_post, slug_from_path
from .db import Database
from .github import GitHub, article_entries, blob_sha


def public_draft(draft: dict) -> dict:
    return {
        **{
            key: draft[key]
            for key in (
                "id",
                "revision",
                "post",
                "source_path",
                "updated_at",
                "published_revision",
                "commit_sha",
            )
        },
        "publish_pending": bool(draft["pending"]),
    }


async def publish(db: Database, github: GitHub, draft_id: str, revision: int):
    draft = db.draft(draft_id)
    if not draft:
        raise HTTPException(404, "초안을 찾지 못했습니다.")
    if draft["revision"] != revision:
        raise HTTPException(409, "다른 창에서 초안이 수정되었습니다. 새로 불러와 주세요.")
    head, tree_sha, tree = await github.snapshot()

    def finish(pending):
        with db.connect() as connection:
            connection.execute(
                """UPDATE drafts SET source_path=?, source_sha=?, published_revision=?,
                commit_sha=?, original=?, pending=NULL WHERE id=?""",
                (
                    pending["path"],
                    pending["blob_sha"],
                    pending["revision"],
                    pending["commit_sha"],
                    json.dumps(pending["original"], ensure_ascii=False),
                    draft_id,
                ),
            )
        return public_draft(db.draft(draft_id))

    # Recover a successful remote publish if the response or local write was lost.
    if draft["pending"]:
        if await github.applied(draft["pending"]["commit_sha"], head):
            return finish(draft["pending"])
        with db.connect() as connection:
            connection.execute("UPDATE drafts SET pending=NULL WHERE id=?", (draft_id,))

    if draft["published_revision"] == revision:
        return public_draft(draft)
    post = PostInput.model_validate(draft["post"])
    if not post.title.strip() or not post.slug or not post.body.strip() or not post.description.strip():
        raise HTTPException(400, "발행하려면 제목, 주소, 설명, 본문을 입력해 주세요.")
    now = datetime.now(UTC)
    if post.date > now.astimezone(KST).date():
        raise HTTPException(400, "미래 날짜의 예약 발행은 아직 지원하지 않습니다.")
    target = draft["source_path"] or post_path(post)
    if draft["source_path"]:
        existing = tree.get(target)
        if not existing or existing["sha"] != draft["source_sha"]:
            raise HTTPException(
                409,
                "편집을 시작한 뒤 GitHub의 원본이 변경되었습니다. 초안을 복사해 보관하고 최신 글을 다시 불러와 주세요.",
            )
    else:
        for path, _ in article_entries(tree):
            if category_from_path(path) == post.category and slug_from_path(path) == post.slug:
                raise HTTPException(
                    409, "같은 주소의 글이 이미 있습니다. 기존 글을 불러오거나 다른 주소를 사용해 주세요."
                )

    modified = now.isoformat(timespec="seconds")
    text = serialize_post(post, draft["original"], modified)
    files = {target: text.encode()}
    for asset in db.assets(draft_id):
        files[f"public/assets/images/{asset['name']}"] = asset["data"]
    commit = await github.create_commit(head, tree_sha, files, post.title)
    pending = {
        "path": target,
        "blob_sha": blob_sha(files[target]),
        "revision": revision,
        "commit_sha": commit["sha"],
        "original": {**draft["original"], "updatedAt": modified},
    }
    # Persist before moving the branch, allowing safe recovery after timeouts/restarts.
    with db.connect() as connection:
        connection.execute("UPDATE drafts SET pending=? WHERE id=?", (json.dumps(pending), draft_id))
    await github.advance(commit["sha"])
    return finish(pending)
