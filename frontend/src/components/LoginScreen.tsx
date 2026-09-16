import { GoogleIcon } from './Icons'
import logo from '../assets/logo.png'

export default function LoginScreen({ error, blogUrl }: { error: string; blogUrl: string }) {
  const failed = error || new URLSearchParams(location.search).get('error')
  return (
    <main className="login">
      <div className="login-card">
        <img className="login-logo" src={logo} alt="" />
        <p className="login-brand">Trace of Thought</p>
        <h1 className="login-title">BlogStudio</h1>
        <p className="login-lede">글을 쓰고, 고치고, 커밋 한 번으로 발행하는 개인 작업실.</p>
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
          등록된 계정 한 개만 사용할 수 있습니다 · <a href={blogUrl}>{blogUrl.replace(/^https?:\/\//, '')}</a>
        </p>
      </div>
    </main>
  )
}
