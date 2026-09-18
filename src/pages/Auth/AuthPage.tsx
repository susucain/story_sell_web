import { Button, Form, Input, message } from 'antd'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../../auth/auth-context'
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
      <div className="auth-brand"><span className="auth-brand-mark" />映语 AI</div>
      <div className="auth-preview-copy"><h1>{isRegister ? '从第一条灵感，开始你的创作工作台' : '从灵感到成片，持续保持创作节奏'}</h1><p>统一管理素材、脚本与生成任务，让每次创作都自然衔接。</p></div>
      <div className="auth-workspace-preview"><strong>静音榨汁杯短视频策划</strong><div className="auth-preview-row"><span /><i /><i /></div><div className="auth-preview-row"><span /><i /><i /></div></div>
    </section>
    <section className="auth-form-panel"><div className="auth-form">
      <div className="auth-form-heading"><div><h2>{isRegister ? '创建账号' : '欢迎回来'}</h2><p>{isRegister ? '注册灵剪 AI，开始你的创作' : '登录灵剪 AI，继续你的创作'}</p></div><Link to={isRegister ? '/login' : '/register'}>{isRegister ? '返回登录' : '注册账号'}</Link></div>
      <Form layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item label="账号" name="account" rules={[{ required: true, message: '请输入账号' }]}><Input autoComplete="username" placeholder="请输入账号" /></Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="请输入密码" /></Form.Item>
        {isRegister && <Form.Item label="确认密码" name="confirmPassword" dependencies={['password']} rules={[{ required: true, message: '请再次输入密码' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')) })]}><Input.Password autoComplete="new-password" placeholder="再次输入密码" /></Form.Item>}
        <Button type="primary" htmlType="submit" loading={submitting} block>{isRegister ? '创建账号' : '登录'}</Button>
      </Form>
      <p className="auth-agreement">{isRegister ? '创建账号' : '登录'}即代表你同意服务协议和隐私政策</p>
    </div></section>
  </main>
}
