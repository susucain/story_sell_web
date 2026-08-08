import { memo, useState } from 'react'
import { Button, Tag, Progress, Popconfirm } from 'antd'
import {
  PlusOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
  PictureOutlined,
  LinkOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import type { AssetItem, ScriptVersion, VideoTaskItem } from './types'

interface RightPanelProps {
  assets: AssetItem[]
  scripts: ScriptVersion[]
  videos: VideoTaskItem[]
  currentScriptId?: number
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
  onAddAsset?: () => void
  onDeleteAsset?: (asset: AssetItem) => void
  onSelectScript?: (script: ScriptVersion) => void
  onSelectVideo?: (video: VideoTaskItem) => void
}

export type TabKey = 'assets' | 'scripts' | 'videos'

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

function assetStatusText(status: string): string {
  switch (status) {
    case 'parsed':
      return '已解析'
    case 'pending':
      return '待解析'
    case 'failed':
      return '解析失败'
    default:
      return status
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
  currentScriptId,
  activeTab: tab,
  onTabChange,
  onAddAsset,
  onDeleteAsset,
  onSelectScript,
  onSelectVideo,
}: RightPanelProps) {
  const [showAllScripts, setShowAllScripts] = useState(false)

  const displayedScripts = showAllScripts ? scripts : scripts.slice(0, 3)

  return (
    <div className="lj-right-panel">
      {/* 标签头 */}
      <div className="lj-right-panel__tabs">
        <button
          className={`lj-tab ${tab === 'assets' ? 'active' : ''}`}
          onClick={() => onTabChange('assets')}
        >
          素材 <span className="lj-tab-count">{assets.length}</span>
        </button>
        <button
          className={`lj-tab ${tab === 'scripts' ? 'active' : ''}`}
          onClick={() => onTabChange('scripts')}
        >
          脚本 <span className="lj-tab-count">{scripts.length}</span>
        </button>
        <button
          className={`lj-tab ${tab === 'videos' ? 'active' : ''}`}
          onClick={() => onTabChange('videos')}
        >
          视频 <span className="lj-tab-count">{videos.length}</span>
        </button>
      </div>

      <div className="lj-right-panel__body">
        {/* 素材 */}
        {tab === 'assets' && (
          <div className="lj-panel-section">
            <div className="lj-panel-section__head">
              <span className="lj-panel-section__title">本轮素材</span>
              <div>
                <button className="lj-link-btn" onClick={onAddAsset}>
                  <PlusOutlined /> 添加素材
                </button>
              </div>
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
                      {asset.assetType === 'video' ? (
                        <video src={asset.url} muted />
                      ) : (
                        <img src={asset.thumbnailUrl || asset.url} alt={asset.name} />
                      )}
                      <span className="lj-asset-card__type">
                        {asset.assetType === 'video' ? <VideoCameraOutlined /> : asset.assetType === 'url' ? <LinkOutlined /> : <PictureOutlined />}
                      </span>
                    </div>
                    <div className="lj-asset-card__info">
                      <div className="lj-asset-card__label">{asset.name}</div>
                      <div className="lj-asset-card__status">
                        {asset.status === 'parsed' ? (
                          <CheckCircleFilled style={{ color: '#10b981' }} />
                        ) : asset.status === 'failed' ? (
                          <ExclamationCircleOutlined style={{ color: '#ef4444' }} />
                        ) : (
                          <LoadingOutlined style={{ color: '#6366f1' }} />
                        )}{' '}
                        {assetStatusText(asset.status)}
                      </div>
                    </div>
                    {onDeleteAsset && (
                      <Popconfirm
                        title="删除素材"
                        description="确定要删除这个素材吗？"
                        onConfirm={() => onDeleteAsset(asset)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          className="lj-asset-card__delete"
                        />
                      </Popconfirm>
                    )}
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
              {scripts.length > 3 && (
                <button className="lj-link-btn" onClick={() => setShowAllScripts(!showAllScripts)}>
                  {showAllScripts ? '收起' : '查看全部'}
                </button>
              )}
            </div>
            {scripts.length === 0 ? (
              <div className="lj-empty-hint">
                <FileTextOutlined className="lj-empty-icon" />
                <p>暂无脚本，开始对话生成第一个分镜</p>
              </div>
            ) : (
              <div className="lj-script-list">
                {displayedScripts.map((script) => {
                  const isCurrent = script.id === currentScriptId
                  return (
                    <div
                      className={`lj-script-version ${isCurrent ? 'current' : ''}`}
                      key={script.id}
                      onClick={() => onSelectScript?.(script)}
                    >
                      <div className="lj-script-version__badge">V{script.version}</div>
                      <div className="lj-script-version__body">
                        <div className="lj-script-version__title">{script.title}</div>
                        <div className="lj-script-version__meta">
                          {script.shots.length} 个镜头 ·{' '}
                          {script.status === 'used_for_video' ? '已生成视频' : '尚未生成视频'}
                        </div>
                      </div>
                      {isCurrent && <span className="lj-script-version__current">当前</span>}
                    </div>
                  )
                })}
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
              <div className="lj-video-empty">
                <div className="lj-video-empty__title">等待发起生成</div>
                <div className="lj-video-empty__desc">
                  {scripts.length > 0
                    ? `引用 V${Math.max(...scripts.map((s) => s.version))} 并补充达人素材，可生成 9:16 成片。`
                    : '引用脚本并补充达人素材，可生成 9:16 成片。'}
                </div>
                <div className="lj-video-empty__bar"><span /></div>
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
