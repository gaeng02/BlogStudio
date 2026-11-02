import base64
import hashlib
from urllib.parse import quote

import httpx

from .config import Settings
from .content import category_from_path


class GitHubError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


class GitHub:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base = f"https://api.github.com/repos/{quote(settings.github_owner, safe='')}/{quote(settings.github_repo, safe='')}"
        # One pooled client for the app's lifetime: each action makes several calls in a row,
        # and a client per call paid a new TLS handshake and certificate load every time.
        self.client: httpx.AsyncClient | None = None

    async def request(self, method: str, path: str, **kwargs):
        if not self.settings.github_token:
            raise GitHubError("GitHub 발행 권한이 아직 설정되지 않았습니다.", 503)
        if self.client is None:
            self.client = httpx.AsyncClient(timeout=30)
        try:
            response = await self.client.request(
                method,
                self.base + path,
                headers={
                    "Authorization": f"Bearer {self.settings.github_token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                **kwargs,
            )
        except httpx.RequestError as error:
            raise GitHubError(
                "GitHub 응답을 확인하지 못했습니다. 초안은 보존됩니다. 다시 시도해 주세요."
            ) from error
        if response.status_code in {409, 422}:
            raise GitHubError(
                "GitHub 내용 또는 브랜치 규칙과 충돌했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.", 409
            )
        if not response.is_success:
            raise GitHubError(
                f"GitHub 요청에 실패했습니다 (HTTP {response.status_code}). 저장소와 토큰 권한을 확인해 주세요."
            )
        return response.json()

    async def close(self):
        if self.client is not None:
            await self.client.aclose()
            self.client = None

    async def files(self, tree: str) -> dict:
        """All files of a tree, given its SHA or a branch name, in one request."""
        result = await self.request("GET", f"/git/trees/{quote(tree, safe='')}?recursive=1")
        if result.get("truncated"):
            raise GitHubError("저장소의 파일 목록이 너무 커 전체 내용을 읽지 못했습니다.")
        return {entry["path"]: entry for entry in result["tree"]}

    async def branch_files(self) -> dict:
        """Current files for reads that need no parent commit, such as opening an article."""
        return await self.files(self.settings.github_branch)

    async def snapshot(self):
        branch = quote(self.settings.github_branch, safe="")
        # The branch response names both the head commit and its tree: one request fewer.
        found = await self.request("GET", f"/branches/{branch}")
        head = found["commit"]["sha"]
        tree_sha = found["commit"]["commit"]["tree"]["sha"]
        return head, tree_sha, await self.files(tree_sha)

    async def read_blob(self, sha: str) -> str:
        result = await self.request("GET", f"/git/blobs/{sha}")
        if result.get("size", 0) > 1_000_000 or result.get("encoding") != "base64":
            raise GitHubError("1MB 이하의 Markdown 글만 편집할 수 있습니다.", 400)
        return base64.b64decode(result["content"]).decode("utf-8")

    async def create_commit(self, head: str, tree_sha: str, files: dict[str, bytes], title: str):
        entries = []
        for path, data in files.items():
            result = await self.request(
                "POST", "/git/blobs", json={"content": base64.b64encode(data).decode(), "encoding": "base64"}
            )
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": result["sha"]})
        tree = await self.request("POST", "/git/trees", json={"base_tree": tree_sha, "tree": entries})
        return await self.request(
            "POST",
            "/git/commits",
            json={
                "message": f"post: {title}",
                "tree": tree["sha"],
                "parents": [head],
            },
        )

    async def advance(self, sha: str):
        # Never force: another writer's commit must not be discarded.
        branch = quote(self.settings.github_branch, safe="")
        return await self.request("PATCH", f"/git/refs/heads/{branch}", json={"sha": sha, "force": False})

    async def applied(self, sha: str, head: str) -> bool:
        comparison = await self.request("GET", f"/compare/{sha}...{head}")
        return comparison["status"] in {"identical", "ahead"}


def article_entries(tree: dict):
    for path, entry in tree.items():
        if entry.get("type") != "blob" or entry.get("mode") not in {"100644", "100755"}:
            continue
        try:
            category_from_path(path)
        except ValueError:
            continue
        yield path, entry
