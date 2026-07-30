import { memo, useState } from 'react'
import { Button, Tag, Progress } from 'antd'
import {
  PlusOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
  PictureOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import type { AssetItem, ScriptVersion, VideoTaskItem } from './types'

interface RightPanelProps {
  assets: AssetItem[]
  scripts: ScriptVersion[]
  videos: VideoTaskItem[]
  onAddAsset?: () => void
  onSelectScript?: (script: ScriptVersion) => void
  onSelectVideo?: (video: VideoTaskItem) => void
}

type TabKey = 'assets' | 'scripts' | 'videos'

function statusMeta(status: string): { text: string; color: string; icon: React.ReactNode } {
  switch (status) {
    case 'succeeded':
      return { text: '生成成功', color: '#10b981', icon: <CheckCircleFilled /> }
    case 'running':
      return { text: '生成中', color: '#6366f1', icon: <LoadingOutlined /> }
    case 'queued':
      return { text: '排队中', color: '#f59e0b', icon: <ClockCircleOutlined /> }
    case 'failed':
      return { text: '生成失败', color: '#ef4444', icon: <ExclamationCircleOutlined /> }
    default:
      return { text: status, color: '#9ca3af', icon: <ClockCircleOutlined /> }
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (isToday) return `今天 ${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${mo}-${da} ${hh}:${mm}`
}

export const RightPanel = memo(function RightPanel({
  assets,
  scripts,
  videos,
  onAddAsset,
  onSelectScript,
  onSelectVideo,
}: RightPanelProps) {
  const [tab, setTab] = useState<TabKey>('assets')

  return (
    <div className="lj-right-panel">
      {/* 标签头 */}
      <div className="lj-right-panel__tabs">
        <button
          className={`lj-tab ${tab === 'assets' ? 'active' : ''}`}
          onClick={() => setTab('assets')}
        >
          <PictureOutlined /> 素材 <span className="lj-tab-count">{assets.length}</span>
        </button>
        <button
          className={`lj-tab ${tab === 'scripts' ? 'active' : ''}`}
          onClick={() => setTab('scripts')}
        >
          <FileTextOutlined /> 脚本 <span className="lj-tab-count">{scripts.length}</span>
        </button>
        <button
          className={`lj-tab ${tab === 'videos' ? 'active' : ''}`}
          onClick={() => setTab('videos')}
        >
          <VideoCameraOutlined /> 视频 <span className="lj-tab-count">{videos.length}</span>
        </button>
      </div>

      <div className="lj-right-panel__body">
        {/* 素材 */}
        {tab === 'assets' && (
          <div className="lj-panel-section">
            <div className="lj-panel-section__head">
              <span className="lj-panel-section__title">当前素材</span>
              <button className="lj-link-btn" onClick={onAddAsset}>
                <PlusOutlined /> 添加素材
              </button>
            </div>
            {assets.length === 0 ? (
              <div className="lj-empty-hint">
                <PictureOutlined className="lj-empty-icon" />
                <p>暂无素材，上传图片或视频后自动解析</p>
              </div>
            ) : (
              <div className="lj-asset-grid">
                {assets.map((asset) => (
                  <div className="lj-asset-card" key={asset.id}>
                    <div className="lj-asset-card__thumb">
                      {asset.type === 'video' ? (
                        <video src={asset.url} muted />
                      ) : (
                        <img src={asset.url} alt={asset.label} />
                      )}
                      <span className="lj-asset-card__type">
                        {asset.type === 'video' ? <VideoCameraOutlined /> : <PictureOutlined />}
                      </span>
                    </div>
                    <div className="lj-asset-card__info">
                      <div className="lj-asset-card__label">{asset.label}</div>
                      <div className="lj-asset-card__status">
                        <CheckCircleFilled style={{ color: '#10b981' }} /> {asset.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 脚本 */}
        {tab === 'scripts' && (
          <div className="lj-panel-section">
            <div className="lj-panel-section__head">
              <span className="lj-panel-section__title">脚本版本</span>
              {scripts.length > 1 && <button className="lj-link-btn">查看全部</button>}
            </div>
            {scripts.length === 0 ? (
              <div className="lj-empty-hint">
                <FileTextOutlined className="lj-empty-icon" />
                <p>暂无脚本，开始对话生成第一个分镜</p>
              </div>
            ) : (
              <div className="lj-script-list">
                {scripts.map((script) => (
                  <div
                    className="lj-script-version"
                    key={script.id}
                    onClick={() => onSelectScript?.(script)}
                  >
                    <div className="lj-script-version__badge">{script.version}</div>
                    <div className="lj-script-version__body">
                      <div className="lj-script-version__title">{script.title}</div>
                      <div className="lj-script-version__meta">
                        {script.shotCount} 个镜头 ·{' '}
                        {script.hasVideo ? '已生成视频' : '尚未生成视频'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 视频 */}
        {tab === 'videos' && (
          <div className="lj-panel-section">
            <div className="lj-panel-section__head">
              <span className="lj-panel-section__title">视频任务</span>
            </div>
            {videos.length === 0 ? (
              <div className="lj-empty-hint">
                <VideoCameraOutlined className="lj-empty-icon" />
                <p>等待发起生成</p>
                <span className="lj-empty-sub">引用脚本并补充达人素材，可生成 9:16 成片</span>
              </div>
            ) : (
              <div className="lj-video-task-list">
                {videos.map((task) => {
                  const meta = statusMeta(task.status)
                  const isActive = task.status === 'queued' || task.status === 'running'
                  return (
                    <div
                      className="lj-video-task"
                      key={task.id}
                      onClick={() => task.status === 'succeeded' && onSelectVideo?.(task)}
                      style={{ cursor: task.status === 'succeeded' ? 'pointer' : 'default' }}
                    >
                      <div className="lj-video-task__head">
                        <span className="lj-video-task__id">任务 #{task.id}</span>
                        <Tag
                          style={{
                            color: meta.color,
                            borderColor: meta.color,
                            background: `${meta.color}14`,
                            fontSize: 11,
                            margin: 0,
                          }}
                        >
                          {meta.icon} {meta.text}
                        </Tag>
                      </div>
                      {isActive && (
                        <Progress
                          percent={task.status === 'running' ? 60 : 20}
                          showInfo={false}
                          strokeColor="#6366f1"
                          trailColor="#eef2ff"
                          size="small"
                        />
                      )}
                      <div className="lj-video-task__time">{formatTime(task.createdAt)}</div>
                      {task.status === 'succeeded' && task.generatedVideoUrl && (
                        <Button size="small" type="link" className="lj-video-task__view">
                          点击预览视频 →
                        </Button>
                      )}
                      {task.status === 'failed' && task.errorMessage && (
                        <div className="lj-video-task__error">{task.errorMessage}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
