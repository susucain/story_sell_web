import { memo, useState } from 'react'
import { Button, Popconfirm, Tooltip } from 'antd'
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
  SwapOutlined,
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
  onUpdateAssetPurpose?: (asset: AssetItem, purpose: 'analysis' | 'reference' | 'all') => void
  onSelectScript?: (script: ScriptVersion) => void
  onSelectVideo?: (video: VideoTaskItem) => void
}

export type TabKey = 'assets' | 'scripts' | 'videos'

function statusMeta(status: string): { text: string; description: string; tone: string; icon: React.ReactNode } {
  switch (status) {
    case 'succeeded':
      return {
        text: '视频已生成',
        description: '成片已准备完成，可随时预览。',
        tone: 'success',
        icon: <CheckCircleFilled />,
      }
    case 'running':
      return {
        text: '正在生成视频',
        description: 'AI 正在合成画面与音轨，请稍候。',
        tone: 'generating',
        icon: <LoadingOutlined />,
      }
    case 'persisting':
      return {
        text: '正在保存视频',
        description: '视频已完成合成，正在保存成片。',
        tone: 'generating',
        icon: <LoadingOutlined />,
      }
    case 'queued':
      return {
        text: '等待开始生成',
        description: '任务已提交，正在等待可用的生成资源。',
        tone: 'waiting',
        icon: <ClockCircleOutlined />,
      }
    case 'failed':
      return {
        text: '视频生成失败',
        description: '任务未能完成，请检查后重新发起。',
        tone: 'error',
        icon: <ExclamationCircleOutlined />,
      }
    default:
      return {
        text: status,
        description: '任务状态正在更新。',
        tone: 'waiting',
        icon: <ClockCircleOutlined />,
      }
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
  onUpdateAssetPurpose,
  onSelectScript,
  onSelectVideo,
}: RightPanelProps) {
  const [showAllScripts, setShowAllScripts] = useState(false)

  const displayedScripts = showAllScripts ? scripts : scripts.slice(0, 3)
  const referenceAssets = assets.filter((asset) => asset.assetPurpose !== 'analysis')
  const analysisAssets = assets.filter((asset) => asset.assetPurpose === 'analysis')
  const hasAnalysisOnlyAssets = analysisAssets.length > 0

  const renderAssetCard = (asset: AssetItem) => (
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
      <div className="lj-asset-card__actions">
        {onUpdateAssetPurpose && (
          <Tooltip title={asset.assetPurpose === 'analysis' ? '恢复为分析和生成参考' : '设为仅用于脚本分析'}>
            <Button
              type="text"
              size="small"
              icon={<SwapOutlined />}
              onClick={() => onUpdateAssetPurpose(
                asset,
                asset.assetPurpose === 'analysis' ? 'all' : 'analysis',
              )}
            />
          </Tooltip>
        )}
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
    </div>
  )

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
              <span className="lj-panel-section__title">会话素材</span>
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
            ) : hasAnalysisOnlyAssets ? (
                <>
                <div className="lj-asset-group">
                  {/* <div className="lj-asset-group__title">
                    参考素材 <span>将用于视频生成 · {referenceAssets.length}</span>
                  </div> */}
                  <div className="lj-asset-grid">
                    {referenceAssets.map(renderAssetCard)}
                  </div>
                </div>
                <div className="lj-asset-group">
                  <div className="lj-asset-group__title">
                    分析素材 <span>仅用于脚本分析</span>
                  </div>
                  <div className="lj-asset-grid">
                    {analysisAssets.map(renderAssetCard)}
                  </div>
                </div>
                </>
              ) : (
                <div className="lj-asset-grid">
                  {assets.map(renderAssetCard)}
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
                  const relatedTasks = videos.filter((task) => task.scriptId === script.id)
                  const hasSucceededVideo = relatedTasks.some((task) => task.status === 'succeeded')
                  const hasActiveVideo = relatedTasks.some(
                    (task) => task.status === 'queued'
                      || task.status === 'running'
                      || task.status === 'persisting',
                  )
                  const hasFailedVideo = relatedTasks.length > 0
                    && relatedTasks.every(
                      (task) => ['failed', 'expired', 'cancelled'].includes(task.status),
                    )
                  const videoStatusText = hasSucceededVideo
                    ? '已生成视频'
                    : hasActiveVideo
                      ? '正在生成视频'
                      : hasFailedVideo
                        ? '视频生成失败'
                        : script.status === 'used_for_video'
                          ? '已提交视频生成'
                          : '尚未生成视频'
                  return (
                    <div
                      className={`lj-script-version ${isCurrent ? 'current' : ''}`}
                      key={script.id}
                      onClick={() => onSelectScript?.(script)}
                    >
                      <div className="lj-script-version__body">
                        <div className="lj-script-version__title">
                          V{script.version} · {isCurrent ? '当前脚本' : '脚本版本'}
                        </div>
                        <div className="lj-script-version__meta">
                          {script.shots.length} 个镜头 ·{' '}
                          {videoStatusText}
                        </div>
                      </div>
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
                  const isActive = task.status === 'queued'
                    || task.status === 'running'
                    || task.status === 'persisting'
                  const progress = task.status === 'persisting' ? 85 : task.status === 'running' ? 60 : 20
                  return (
                    <div
                      className={`lj-video-task lj-video-task--${meta.tone}`}
                      key={task.id}
                      onClick={() => task.status === 'succeeded' && onSelectVideo?.(task)}
                      style={{ cursor: task.status === 'succeeded' ? 'pointer' : 'default' }}
                    >
                      <div className="lj-video-task__head">
                        <div className="lj-video-task__status">
                          <span className="lj-video-task__icon">{meta.icon}</span>
                          <span>{meta.text}</span>
                        </div>
                        <span className="lj-video-task__id">任务 #{task.id}</span>
                      </div>
                      <div className="lj-video-task__desc">
                        {task.status === 'failed' && task.errorMessage
                          ? task.errorMessage
                          : meta.description}
                      </div>
                      <div className="lj-video-task__bar" aria-hidden="true">
                        <span
                          className={isActive ? 'is-active' : ''}
                          style={{ width: `${task.status === 'succeeded' ? 100 : progress}%` }}
                        />
                      </div>
                      <div className="lj-video-task__footer">
                        <span className="lj-video-task__time">{formatTime(task.createdAt)}</span>
                        {task.status === 'succeeded' && task.generatedVideoUrl && (
                          <span className="lj-video-task__view">
                            预览成片 <VideoCameraOutlined />
                          </span>
                        )}
                      </div>
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
