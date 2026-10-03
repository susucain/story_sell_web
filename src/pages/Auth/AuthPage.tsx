import { Button, Form, Input, message } from 'antd'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/auth-context'
import { accountRules, confirmPasswordRules, loginPasswordRules, registerPasswordRules } from '../../auth/credential-rules'
import { reportError } from '../../lib/report-error'
import './style.css'

type AuthPageProps = { mode: 'login' | 'register' }
type LoginValues = { account: string; password: string }
type RegisterValues = LoginValues & { confirmPassword: string }

export function AuthPage({ mode }: AuthPageProps) {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const isRegister = mode === 'register'
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/life-video'

  async function submit(values: LoginValues | RegisterValues) {
    setSubmitting(true)
    try {
      if (isRegister) await auth.register(values as RegisterValues)
      else await auth.login((values as LoginValues).account, (values as LoginValues).password)
      navigate(from, { replace: true })
    } catch (error) {
      reportError('auth.submit', error)
      message.error(error instanceof Error ? error.message : '请求失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-preview">
      <div className="auth-preview-bg" aria-hidden="true">
        <span className="auth-blob auth-blob--1" />
        <span className="auth-blob auth-blob--2" />
        <span className="auth-blob auth-blob--3" />
      </div>
      <div className="auth-brand"><span className="auth-brand-mark" />映语 AI</div>
      <div className="auth-preview-copy"><h1>{isRegister ? '从第一条灵感，开始你的创作工作台' : '从灵感到成片，持续保持创作节奏'}</h1><p>统一管理素材、脚本与生成任务，让每次创作都自然衔接。</p></div>
      <AuthWorkspacePreview />
    </section>
    <section className="auth-form-panel"><div className="auth-form">
      <div className="auth-form-heading"><div><h2>{isRegister ? '创建账号' : '欢迎回来'}</h2><p>{isRegister ? '注册映语 AI，开始你的创作' : '登录映语 AI，继续你的创作'}</p></div><Link to={isRegister ? '/login' : '/register'}>{isRegister ? '返回登录' : '注册账号'}</Link></div>
      <Form layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item label="账号" name="account" rules={accountRules}><Input autoComplete="username" placeholder="请输入账号" /></Form.Item>
        <Form.Item label="密码" name="password" rules={isRegister ? registerPasswordRules : loginPasswordRules}><Input.Password autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="请输入密码" /></Form.Item>
        {isRegister && <Form.Item label="确认密码" name="confirmPassword" dependencies={['password']} rules={confirmPasswordRules}><Input.Password autoComplete="new-password" placeholder="再次输入密码" /></Form.Item>}
        <Button type="primary" htmlType="submit" loading={submitting} block>{isRegister ? '创建账号' : '登录'}</Button>
      </Form>
      <p className="auth-agreement">{isRegister ? '创建账号' : '登录'}即代表你同意服务协议和隐私政策</p>
      <p className="auth-filing"><a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer">浙ICP备2026082524号-1</a></p>
    </div></section>
  </main>
}

type WorkspaceTask = { label: string; stage: 'done' | 'generating' | 'queued' }
const WORKSPACE_CYCLES: WorkspaceTask[][] = [
  [
    { label: '脚本策划', stage: 'done' },
    { label: '分镜 · 第 1 段', stage: 'generating' },
    { label: '分镜 · 第 2 段', stage: 'queued' },
  ],
  [
    { label: '脚本策划', stage: 'done' },
    { label: '分镜 · 第 1 段', stage: 'done' },
    { label: '视频合成中', stage: 'generating' },
  ],
  [
    { label: '脚本策划', stage: 'done' },
    { label: '视频 · 第一段完成', stage: 'done' },
    { label: '续接 · 第二段生成中', stage: 'generating' },
  ],
]

function AuthWorkspacePreview() {
  const [cycle, setCycle] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const progressTimer = setInterval(() => {
      setProgress(p => (p >= 100 ? 0 : p + 4))
    }, 120)
    const cycleTimer = setInterval(() => {
      setCycle(c => (c + 1) % WORKSPACE_CYCLES.length)
      setProgress(0)
    }, 2600)
    return () => { clearInterval(progressTimer); clearInterval(cycleTimer) }
  }, [])

  const tasks = WORKSPACE_CYCLES[cycle]
  return (
    <div className="auth-workspace-preview">
      <header>
        <span className="auth-ws-dot" />
        <strong>火锅门店推广短视频策划</strong>
      </header>
      <div className="auth-ws-progress"><i style={{ width: `${progress}%` }} /></div>
      <ul className="auth-ws-list" key={cycle}>
        {tasks.map((t, i) => (
          <li key={i} data-stage={t.stage} style={{ animationDelay: `${i * 120}ms` }}>
            <span className="auth-ws-thumb" />
            <div className="auth-ws-meta">
              <span>{t.label}</span>
              <em data-status={t.stage}>
                {t.stage === 'done' ? '已完成' : t.stage === 'generating' ? '生成中' : '排队中'}
              </em>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
