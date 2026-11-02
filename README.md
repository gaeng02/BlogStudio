# BlogStudio

개인 Google 계정으로 로그인하여 글을 작성하고, GitHub Pages 블로그의 기존 글을 수정하는 웹 편집기입니다.

- 공개 블로그: `https://www.gaeng02.com` — Next.js 정적 사이트 / GitHub Pages
- 편집기: `https://www.gaeng02.com/studio` — React + FastAPI / EC2 (운영 중)
- 로그인 허용 계정: `sondin144@gmail.com` (`ALLOWED_EMAIL`로 설정)
- 초안·업로드 이미지·세션: EC2의 SQLite 데이터베이스
- 발행 대상: `gaeng02/gaeng02.github.io`, `main` 브랜치

## 글 작성과 수정

1. Google 계정으로 로그인합니다.
2. **새 글 쓰기**를 누르거나, 발행된 글의 **주소를 붙여넣어** 불러옵니다. 공개 블로그에서 복사한 `https://www.gaeng02.com/…` 전체 주소나 `/memoir/2025-03-SWMaestro` 같은 경로를 넣고 **열기**를 누릅니다. 주소 뒤의 `#목차` 앵커나 `?` 쿼리는 무시합니다. 글 목록을 탐색하는 기능은 없으며, GitHub에서는 브랜치의 파일 목록 한 번과 그 글 하나만 읽습니다. 이미 수정 중인 글이면 GitHub를 거치지 않고 초안을 바로 엽니다.
3. 본문은 공개 블로그의 글 화면과 같은 모양 그대로 편집합니다(Notion 방식). `/`를 입력하면 제목·목록·인용·코드·구분선·표·이미지·접기 블록을 고를 수 있고, 글자를 선택하면 서식 메뉴(제목·굵게·기울임·취소선·코드·인용·링크)가 뜹니다. `## `, `- `, `1. `, `> `, ` ``` `, `**굵게**` 같은 Markdown 입력도 바로 변환됩니다. 카테고리·주소·발행일·표지·검색 결과 설명은 위쪽 글 정보 칸에서 고칩니다. `⌘S`(`Ctrl+S`)로 저장합니다.
   - 저장 형식은 그대로 Markdown입니다. 기존 글을 열고 고치지 않으면 원문이 한 글자도 바뀌지 않습니다. 고치면 Markdown 표기가 정리됩니다(예: 줄 끝 공백 두 칸 줄바꿈 → `\` 줄바꿈). 공개 글의 모양은 같습니다.
   - 본문에 직접 쓴 HTML(`<details>`, 스타일을 넣은 `<table>` 등)은 블로그와 같은 모양으로 보이는 **HTML 블록**으로 다룹니다. 원문 그대로 저장되고, 블록 위의 **원문 편집**으로 HTML을 고칠 수 있습니다.
4. 이미지는 **이미지 추가** 버튼, 드래그 앤 드롭, 붙여넣기로 올립니다. 파일명은 신경 쓰지 않아도 됩니다. 서버가 이미지 **내용의 SHA-256 해시 앞 16자**로 이름을 정하므로(`/assets/images/4ee04ab51698e739.png`) 같은 이미지는 항상 같은 이름을 갖고 다른 이미지와 겹치지 않습니다. 본문에는 Markdown 이미지 문법이 커서 위치에 들어가고, 첨부 목록에서 **표지로 사용**·**본문에 삽입**을 누를 수 있습니다.
5. **초안 저장**은 SQLite에만 비공개로 저장합니다. 자동 저장은 아니며, 저장하지 않은 내용이 있으면 표시하고 페이지를 떠날 때 경고합니다.
6. **발행 / 수정 발행**은 글과 업로드 이미지를 하나의 Git 커밋으로 반영합니다. GitHub Actions 배포가 끝나면 공개 블로그가 갱신됩니다. 커밋 성공과 배포 성공은 별개이며 화면의 **배포 상태 확인** 링크에서 확인합니다.

초안은 사이드바의 휴지통 아이콘으로 **삭제**합니다. 저장된 본문과 이미지가 함께 지워집니다. 발행된 글을 불러온 수정 초안을 지워도 GitHub의 글은 그대로 남습니다. 발행 결과 확인이 필요한 초안(발행 응답이 끊긴 경우)은 먼저 발행 버튼으로 결과를 확인한 뒤 삭제할 수 있습니다.

기존 글은 파일 경로, 카테고리, slug, 최초 발행일을 유지합니다. 제목·본문·설명·태그·표지는 수정할 수 있고 `updatedAt`을 기록합니다. 기존 frontmatter의 추가 필드도 보존합니다. 예를 들어 회고 글의 `/memoir/2025-03-SWMaestro` 주소는 바뀌지 않습니다.

같은 글을 다시 열면 이미 작성 중인 수정 초안을 이어서 엽니다. GitHub에서 원본이 변경되면 발행을 거절하고 초안을 보존합니다. **GitHub 최신 원본 다시 불러오기**는 기존 초안과 이미지를 복구용 사본으로 보관한 뒤 최신 원본을 가져옵니다. 사본은 주소를 비워 두므로 실수로 같은 URL에 발행되지 않습니다.

발행 응답이 끊기면 발행 버튼을 다시 눌러 결과를 확인합니다. 서버는 저장된 커밋 정보를 통해 이미 성공한 발행을 복구하며 강제 push를 하지 않습니다. 브랜치가 변경되어 충돌한 경우 새 기준 커밋으로 재시도합니다.

미리보기는 공개 블로그와 같은 렌더링 규칙을 씁니다. GFM과 본문 안의 HTML(`<img>`, `<details>`, `<table>` 등)을 허용하되 `script`, `iframe`, 이벤트 핸들러, `style` 속성은 제거합니다. 화면은 시스템 설정을 따르는 라이트/다크 모드를 지원하며 상단 바에서 바꿀 수 있습니다.

현재 범위는 글 작성·수정·초안 삭제입니다. GitHub에 발행된 글 삭제, 주소 변경, 예약 발행, 시리즈 정의 편집은 포함하지 않습니다. 기존에 정의된 시리즈 태그를 글에 넣으면 공개 블로그가 빌드 시 시리즈에 반영합니다.

## 로컬 실행

Python 3.12 이상(개발/컨테이너 검증 기준 3.14), Node.js 22 이상, uv를 사용합니다.

```bash
cp .env.example .env
uv sync --frozen
cd frontend
npm ci
npm run build
cd ..
uv run uvicorn app.main:get_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

먼저 `.env`의 `SESSION_SECRET`을 32자 이상의 난수로 설정하세요. `python -c 'import secrets; print(secrets.token_urlsafe(48))'`로 생성할 수 있습니다. 설정하지 않으면 서버가 시작하지 않습니다. 로그인 연결 전에는 로그인 화면을 확인할 수 있으며, 개발용 로그인 우회 기능은 없습니다.

로컬 주소는 `http://localhost:8000/studio/`입니다. Google 설정과 GitHub 토큰을 채우면 실제 로그인·발행이 가능하므로 로컬에서도 **발행** 버튼은 실제 저장소를 변경합니다.

프론트엔드 개발 서버를 따로 사용할 때는 `.env`의 `STUDIO_URL=http://localhost:5173/studio`를 설정하고 Google에 동일한 호스트의 callback을 등록한 뒤 `frontend`에서 `npm run dev`를 실행합니다. Vite가 `/studio/api`와 `/studio/auth`를 FastAPI로 전달합니다.

## Google 로그인 설정

Google Cloud에서 프로젝트를 만들고 Google Auth Platform의 Branding, Audience, Clients를 설정합니다. 로그인에는 `openid email profile`만 요청합니다.

- OAuth client 유형: **Web application**
- 로컬 승인된 리디렉션 URI: `http://localhost:8000/studio/auth/callback`
- 운영 승인된 리디렉션 URI: `https://www.gaeng02.com/studio/auth/callback`
- 테스트 상태라면 테스트 사용자에 본인 계정을 등록합니다.
- 발급받은 값을 `.env`의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 설정합니다.

Google에서 검증된 ID 토큰의 이메일과 `email_verified`를 확인하고 `ALLOWED_EMAIL`과 비교합니다. 로그인 상태는 DB의 만료되는 세션으로 관리하며 쿠키에는 임의의 세션 식별자만 저장합니다. 운영 쿠키는 Secure / HttpOnly / SameSite=Lax / Path=/studio입니다. 모든 글·이미지 API에서 세션을 확인하고 변경 요청(POST/PUT/DELETE)은 Origin과 CSRF 토큰도 확인합니다.

공식 문서: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Authlib FastAPI](https://docs.authlib.org/en/latest/oauth2/client/web/fastapi.html).

## GitHub 연결

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**에서 발급합니다.

- Resource owner: `gaeng02`
- Repository access: **Only select repositories → gaeng02.github.io**
- Repository permissions: **Contents: Read and write** (Metadata 읽기는 기본)
- 만료일을 설정하고, 만료 전에 새 토큰으로 교체합니다.
- 값을 서버 `.env`의 `GITHUB_TOKEN`에만 저장합니다. 저장소나 프론트엔드 변수에 넣지 않습니다.

Google 로그인 권한과 GitHub 발행 권한은 별개입니다. GitHub 토큰의 권한 범위는 저장소 단위이고 특정 폴더로 제한되지 않습니다. 앱은 허용된 콘텐츠 폴더와 이미지 경로만 변경하도록 구현되어 있습니다. `main` 브랜치 규칙이 직접 쓰기를 금지하면 발행이 실패하므로 해당 저장소 규칙과 발행 방식이 맞는지 확인해야 합니다.

## 운영 구성과 `/studio` 경로

```text
www.gaeng02.com/일반경로  → GitHub Pages
www.gaeng02.com/studio/* → Cloudflare Worker → EC2(Caddy → FastAPI)
```

- EC2에서 Docker Compose(`production` 프로필)로 FastAPI와 Caddy가 실행됩니다. 8000 포트는 외부에 열지 않습니다.
- `.env`는 `STUDIO_URL=https://www.gaeng02.com/studio`, `BLOG_URL=https://www.gaeng02.com`, 원본 호스트 `STUDIO_ORIGIN_HOST`를 사용합니다. `STUDIO_URL`은 브라우저에 보이는 주소이며 원본 EC2 호스트를 넣으면 Google callback과 Origin 검사에 맞지 않습니다.
- `deploy/worker.mjs`가 Cloudflare Worker로 등록되어 `www.gaeng02.com/studio*` 경로만 원본(`ORIGIN_URL`)으로 전달하고 `private, no-store`, `noindex`를 붙입니다. `/studio`와 하위 경로는 Cloudflare Cache Rule에서 **Bypass cache**입니다.
- 응답의 Content-Security-Policy는 자체 스크립트만 허용하고, 미리보기 글꼴을 위해 `fonts.googleapis.com` 스타일시트와 `fonts.gstatic.com` 글꼴만 추가로 허용합니다.

재배포는 EC2에서 다음과 같이 합니다.

```bash
git pull
docker compose --profile production up -d --build
docker compose logs -f studio   # 기동 확인
```

앱이 시작할 때 SQLite 스키마를 확인하고 필요한 마이그레이션을 자동으로 적용합니다(현재 버전 2: 이미지 테이블 키가 `(draft_id, name)`). 업그레이드 전에 아래 백업을 먼저 받아 두세요. 이전 버전으로 되돌리려면 백업 DB로 교체해야 합니다.

로컬 Docker만 확인하려면 `.env`를 로컬 설정으로 두고 `docker compose up -d --build`를 실행합니다. Caddy는 production 프로필에서만 실행됩니다.

공식 문서: [FastAPI Docker](https://fastapi.tiangolo.com/deployment/docker/), [Cloudflare Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).

## 데이터와 운영

- Docker의 `studio_data` 볼륨에 DB·초안·이미지가 들어갑니다. 컨테이너를 교체해도 남지만 EC2/볼륨 삭제에 대비한 별도 백업은 필요합니다.
- 이미지당 5MB, 초안당 합계 25MB 제한입니다. 실제 이미지 데이터를 검사하여 PNG/JPEG/GIF/WebP만 받습니다. 이미지 이름은 내용 해시이므로 같은 이미지를 여러 초안에 올려도 저장소에는 한 파일로 반영됩니다.
- 현재는 **Uvicorn worker 1개 / 앱 인스턴스 1개**로 운영합니다. 발행·수정 동시성 제어를 위해 이 설정을 유지합니다. 여러 인스턴스를 쓰려면 분산 잠금과 데이터 저장 구조 변경이 필요합니다.
- 초안·이미지 자동 정리 기능은 없습니다. 필요 없는 초안은 화면에서 삭제하고 저장 공간을 확인합니다.
- Google/GitHub 비밀값은 `.env`로 주입합니다. 로그에 OAuth callback code가 남지 않도록 Uvicorn access log는 끕니다.

일관된 SQLite 백업:

```bash
docker compose exec studio python scripts/backup.py /data/backups/studio-2026-09-15.sqlite3
docker compose cp studio:/data/backups/studio-2026-09-15.sqlite3 ./studio-2026-09-15.sqlite3
```

파일명은 매번 바꿉니다. 백업을 EC2 밖에 보관하세요. 복구할 때는 앱을 중지하고 DB를 교체하며, 기존 WAL/SHM 파일을 남기지 않고 권한을 확인한 뒤 다시 시작합니다. 백업에는 세션도 있으므로 유출 시 세션을 폐기해야 합니다.

## 검증

```bash
uv run pytest -q
uv run ruff check app tests
node --test tests/worker.test.mjs
cd frontend
npm run build
npx playwright install chromium
npm test
```

Python 테스트는 허용 계정·인증·CSRF, 초안 충돌, 기존 URL 보존, GitHub 충돌, 이미지 검사와 내용 해시 이름, 초안 삭제, 주소로 불러오기와 GitHub 호출 수, 발행 응답 유실 복구, 스키마 마이그레이션을 검증합니다. 브라우저 테스트는 API 응답을 모의하는 테스트와 실제 FastAPI·임시 SQLite에 연결하는 테스트를 포함합니다. 로그인 화면, 주소로 기존 글 열기, 이미지 업로드, 저장 후 다시 불러오기, 수정 발행, 발행 재시도, 초안 삭제, 다크 모드와 모바일 화면을 검증하고 `frontend/test-results/`에 스크린샷을 남깁니다. GitHub는 테스트용 구현을 사용하여 실제 저장소에 쓰지 않습니다. 실제 Google 인증 및 GitHub 쓰기 권한, EC2/Cloudflare 동작은 운영 환경에서 별도로 확인해야 합니다.
