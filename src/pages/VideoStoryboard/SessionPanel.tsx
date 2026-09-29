import { Button, Input } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { SessionSummary } from './types'
import { UserMenu } from '../../components/UserMenu/UserMenu'

interface SessionPanelProps {
  sessions: SessionSummary[]
  recentSessions: SessionSummary[]
  generatingSessions: SessionSummary[]
  loading: boolean
  error: unknown
  searchQuery: string
  account: string
  activeSessionId: string
  onSearchChange: (value: string) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void
  onRetry: () => void
  onNewSession: () => void
  onSelectSession: (sessionId: string) => void
  onLogout: () => void
  getSessionTitle: (session: SessionSummary) => string
  getSessionMeta: (session: SessionSummary) => string
}

export function SessionPanel({
  sessions,
  recentSessions,
  generatingSessions,
  loading,
  error,
  searchQuery,
  account,
  activeSessionId,
  onSearchChange,
  onCompositionStart,
  onCompositionEnd,
  onScroll,
  onRetry,
  onNewSession,
  onSelectSession,
  onLogout,
  getSessionTitle,
  getSessionMeta,
}: SessionPanelProps) {
  const renderSessionItem = (session: SessionSummary) => {
    const isGenerating = session.status === 'video_generating'
    return (
      <button
        key={session.sessionId}
        type="button"
        className={`lj-session-item ${session.sessionId === activeSessionId ? 'active' : ''}`}
        onClick={() => onSelectSession(session.sessionId)}
      >
        <span className="lj-session-item__title">{getSessionTitle(session)}</span>
        <span className="lj-session-item__meta">
          {isGenerating && <span className="lj-session-item__pulse" />}
          <span>{getSessionMeta(session)}</span>
        </span>
      </button>
    )
  }

  const renderGroup = (title: string, group: SessionSummary[]) => (
    <div className="lj-session-group" key={title}>
      <div className="lj-session-group__title">{title}</div>
      <div onScroll={onScroll} className="lj-session-list">
        {group.map(renderSessionItem)}
      </div>
    </div>
  )

  return (
    <div className="lj-session-panel">
      <div className="lj-sidebar__brand">
        <div className="lj-sidebar__logo" aria-hidden="true" />
        <span className="lj-sidebar__brand-name">映语</span>
      </div>

      <div className="lj-sidebar__actions">
        <Button type="primary" icon={<PlusOutlined />} onClick={onNewSession} className="lj-new-btn" block>
          新对话
        </Button>
        <Input
          placeholder="搜索会话"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          className="lj-search-input"
          maxLength={64}
          allowClear
        />
      </div>

      <div className="lj-sidebar__list">
        {sessions.length === 0 ? (
          <div className="lj-sidebar__empty">
            {loading
              ? '加载中…'
              : error
                ? <Button type="link" onClick={onRetry}>加载失败，点击重试</Button>
                : searchQuery
                  ? '未找到匹配的会话'
                  : '暂无会话，点击新对话开始'}
          </div>
        ) : (
          <>
            {recentSessions.length > 0 && renderGroup('最近创作', recentSessions)}
            {generatingSessions.length > 0 && renderGroup('生成中', generatingSessions)}
          </>
        )}
      </div>

      <div className="lj-sidebar__footer">
        <UserMenu account={account} onLogout={onLogout} />
      </div>
    </div>
  )
}
