# BlogStudio

개인 Google 계정으로 로그인하여 글을 작성하고, GitHub Pages 블로그의 기존 글을 수정하는 웹 편집기입니다.

- 공개 블로그: `https://www.gaeng02.com` — 기존 Next.js 정적 사이트 / GitHub Pages
- 편집기: `https://www.gaeng02.com/studio` — React + FastAPI / EC2
- 로그인 허용 계정: `sondin144@gmail.com` (`ALLOWED_EMAIL`로 설정)
- 초안·업로드 이미지·세션: EC2의 SQLite 데이터베이스
- 발행 대상: `gaeng02/gaeng02.github.io`, `main` 브랜치

## 글 작성과 수정

1. Google 계정으로 로그인합니다.
2. **새 글 쓰기**를 누르거나 **GitHub에 저장된 글 → 글 목록 불러오기**에서 기존 글을 선택합니다.
3. 제목, 설명, 태그, Markdown 본문을 작성합니다. 이미지는 파일 선택·붙여넣기·드래그로 추가할 수 있습니다. 업로드한 이미지 아래의 **표지로 사용**을 누를 수 있습니다.
4. **초안 저장**은 SQLite에만 비공개로 저장합니다. 자동 저장은 아니며, 저장하지 않은 내용이 있으면 표시하고 페이지를 떠날 때 경고합니다.
5. **발행 / 수정 발행**은 글과 업로드 이미지를 하나의 Git 커밋으로 반영합니다. GitHub Actions 배포가 끝나면 공개 블로그가 갱신됩니다. 커밋 성공과 배포 성공은 별개이며 화면의 **배포 상태 확인** 링크에서 확인합니다.

기존 글은 파일 경로, 카테고리, slug, 최초 발행일을 유지합니다. 제목·본문·설명·태그·표지는 수정할 수 있고 `updatedAt`을 기록합니다. 기존 frontmatter의 추가 필드도 보존합니다. 예를 들어 회고 글의 `/memoir/2025-03-SWMaestro` 주소는 바뀌지 않습니다.

같은 글을 다시 열면 이미 작성 중인 수정 초안을 이어서 엽니다. GitHub에서 원본이 변경되면 발행을 거절하고 초안을 보존합니다. **GitHub 최신 원본 다시 불러오기**는 기존 초안과 이미지를 복구용 사본으로 보관한 뒤 최신 원본을 가져옵니다. 사본은 주소를 비워 두므로 실수로 같은 URL에 발행되지 않습니다.

발행 응답이 끊기면 발행 버튼을 다시 눌러 결과를 확인합니다. 서버는 저장된 커밋 정보를 통해 이미 성공한 발행을 복구하며 강제 push를 하지 않습니다. 브랜치가 변경되어 충돌한 경우 새 기준 커밋으로 재시도합니다.

현재 범위는 글 작성·수정입니다. 글 삭제, 주소 변경, 예약 발행, 시리즈 정의 편집은 포함하지 않습니다. 기존에 정의된 시리즈 태그를 글에 넣으면 공개 블로그가 빌드 시 시리즈에 반영합니다.

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

Google에서 검증된 ID 토큰의 이메일과 `email_verified`를 확인하고 `ALLOWED_EMAIL`과 비교합니다. 로그인 상태는 DB의 만료되는 세션으로 관리하며 쿠키에는 임의의 세션 식별자만 저장합니다. 운영 쿠키는 Secure / HttpOnly / SameSite=Lax / Path=/studio입니다. 모든 글·이미지 API에서 세션을 확인하고 변경 요청은 Origin과 CSRF 토큰도 확인합니다.

공식 문서: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Authlib FastAPI](https://docs.authlib.org/en/latest/oauth2/client/web/fastapi.html).

## GitHub 연결

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**에서 발급합니다.

- Resource owner: `gaeng02`
- Repository access: **Only select repositories → gaeng02.github.io**
- Repository permissions: **Contents: Read and write** (Metadata 읽기는 기본)
- 만료일을 설정하고, 만료 전에 새 토큰으로 교체합니다.
- 값을 서버 `.env`의 `GITHUB_TOKEN`에만 저장합니다. 저장소나 프론트엔드 변수에 넣지 않습니다.

Google 로그인 권한과 GitHub 발행 권한은 별개입니다. GitHub 토큰의 권한 범위는 저장소 단위이고 특정 폴더로 제한되지 않습니다. 앱은 허용된 콘텐츠 폴더와 이미지 경로만 변경하도록 구현되어 있습니다. `main` 브랜치 규칙이 직접 쓰기를 금지하면 발행이 실패하므로 해당 저장소 규칙과 발행 방식이 맞는지 확인해야 합니다.

## EC2 배포와 `/studio` 경로

EC2와 DNS는 아직 생성·변경하지 않았습니다. 서버 운영체제·사양 및 원본 서버 주소를 확정한 뒤 아래 설정을 적용합니다.

```text
www.gaeng02.com/일반경로  → GitHub Pages
www.gaeng02.com/studio/* → Cloudflare Worker → EC2(Caddy → FastAPI)
```

1. EC2에 Docker와 Compose를 설치하고 저장소를 가져옵니다.
2. `.env`를 설정합니다. `STUDIO_URL=https://www.gaeng02.com/studio`, `BLOG_URL=https://www.gaeng02.com`을 사용합니다.
3. EC2로 연결되는 원본용 호스트를 정하고 DNS 레코드를 설정합니다. 예: `studio-origin.gaeng02.com`. 이는 아직 생성되지 않은 예시입니다. 그 호스트를 `.env`의 `STUDIO_ORIGIN_HOST`로 지정합니다.
4. EC2에서 80/443을 Caddy로 연결합니다. 8000 포트는 외부에 열지 않습니다. SSH는 관리자의 접속 경로에 맞게 제한합니다.
5. `docker compose --profile production up -d --build`를 실행합니다. Caddy는 원본 호스트의 HTTPS 인증서를 발급받습니다.
6. `deploy/worker.mjs`를 Cloudflare Worker에 등록합니다. 환경 변수 `ORIGIN_URL`을 원본 서버의 HTTPS 주소로 설정합니다. 경로를 붙이지 않습니다.
7. Worker Route를 `www.gaeng02.com/studio*`로 등록합니다. 코드에서 `/studio` 및 `/studio/` 하위 경로만 전달하고 `/studio-other` 등은 기존 원본으로 통과시킵니다. `www` DNS 레코드는 Cloudflare 프록시가 켜져 있어야 합니다.
8. Cloudflare Cache Rule에서 `/studio`와 그 하위 경로를 **Bypass cache**로 설정합니다. 기존 Cache Everything 규칙보다 이 예외가 적용되는지 확인합니다. 앱과 Worker도 `private, no-store`를 반환합니다.
9. 공개 블로그와 `/studio`, 로그인 callback, 이미지 업로드, 신규·수정 발행을 확인합니다.

`STUDIO_URL`은 브라우저에 보이는 주소입니다. 원본 EC2 호스트 주소를 넣으면 Google callback과 Origin 검사에 맞지 않습니다. GitHub Pages의 `www.gaeng02.com` 도메인 설정은 유지하며, `/studio`를 GitHub Pages의 정적 경로로 만들지 않습니다.

로컬 Docker만 확인하려면 `.env`를 로컬 설정으로 두고 `docker compose up -d --build`를 실행합니다. Caddy는 production 프로필에서만 실행됩니다.

공식 문서: [FastAPI Docker](https://fastapi.tiangolo.com/deployment/docker/), [Cloudflare Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).

## 데이터와 운영

- Docker의 `studio_data` 볼륨에 DB·초안·이미지가 들어갑니다. 컨테이너를 교체해도 남지만 EC2/볼륨 삭제에 대비한 별도 백업은 필요합니다.
- 이미지당 5MB, 초안당 합계 25MB 제한입니다. 실제 이미지 데이터를 검사하여 PNG/JPEG/GIF/WebP만 받습니다.
- 현재는 **Uvicorn worker 1개 / 앱 인스턴스 1개**로 운영합니다. 발행·수정 동시성 제어를 위해 이 설정을 유지합니다. 여러 인스턴스를 쓰려면 분산 잠금과 데이터 저장 구조 변경이 필요합니다.
- 초안·이미지 자동 정리 기능은 없으므로 저장 공간을 확인합니다.
- Google/GitHub 비밀값은 `.env`로 주입합니다. 로그에 OAuth callback code가 남지 않도록 Uvicorn access log는 끕니다.

일관된 SQLite 백업:

```bash
docker compose exec studio python scripts/backup.py /data/backups/studio-2026-09-09.sqlite3
docker compose cp studio:/data/backups/studio-2026-09-09.sqlite3 ./studio-2026-09-09.sqlite3
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

Python 테스트는 허용 계정·인증·CSRF, 초안 충돌, 기존 URL 보존, GitHub 충돌, 이미지 검사, 발행 응답 유실 복구를 검증합니다. 브라우저 테스트는 API 응답을 모의하는 테스트와 실제 FastAPI·임시 SQLite에 연결하는 테스트를 포함합니다. 로그인 화면, 기존 글 편집, 이미지 업로드, 저장 후 다시 불러오기, 수정 발행, Markdown 미리보기, 발행 재시도와 모바일 화면을 검증합니다. GitHub는 테스트용 구현을 사용하여 실제 저장소에 쓰지 않습니다. 실제 Google 인증 및 GitHub 쓰기 권한, EC2/Cloudflare 동작은 운영 자격증명과 서버 연결 후 별도로 확인해야 합니다.
