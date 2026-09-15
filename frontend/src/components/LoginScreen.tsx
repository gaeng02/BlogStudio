import { GoogleIcon } from './Icons'

export default function LoginScreen({ error, blogUrl }: { error: string; blogUrl: string }) {
  const failed = error || new URLSearchParams(location.search).get('error')
  return (
    <main className="login">
      <section className="login-hero" aria-hidden="true">
        <p className="login-brand">Trace of Thought</p>
        <h1 className="login-title">BlogStudio</h1>
        <p className="login-lede">글을 쓰고, 고치고, 커밋 한 번으로 발행하는 개인 작업실.</p>
        <ul className="login-points">
          <li>초안과 이미지는 서버에 비공개로 저장됩니다.</li>
          <li>발행하면 GitHub Pages 블로그가 자동으로 갱신됩니다.</li>
          <li>기존 글의 주소와 발행일은 그대로 유지됩니다.</li>
        </ul>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">Sign in</p>
          <h2>관리자 로그인</h2>
          <p className="muted">등록된 Google 계정 한 개만 사용할 수 있습니다.</p>
          <a className="btn btn-google" href="/studio/auth/login">
            <GoogleIcon />
            Google 계정으로 로그인
          </a>
          {failed && (
            <p role="alert" className="alert alert-error">
              {error || '로그인하지 못했습니다. 허용된 Google 계정인지 확인하고 다시 시도해 주세요.'}
            </p>
          )}
          <p className="login-foot">
            공개 블로그 · <a href={blogUrl}>{blogUrl.replace(/^https?:\/\//, '')}</a>
          </p>
        </div>
      </section>
    </main>
  )
}
