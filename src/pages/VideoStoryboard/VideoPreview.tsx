import { memo, useState, useRef } from 'react'
import { Button, Tag, Input } from 'antd'
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  PlayCircleFilled,
  CheckCircleFilled,
  ScissorOutlined,
} from '@ant-design/icons'
import type { ParsedStoryboard, VideoTaskItem, StoryboardShot } from './types'

interface VideoPreviewProps {
  videoTask: VideoTaskItem
  parsed: ParsedStoryboard | null
  sessionTitle: string
  onBack: () => void
}

/** 根据镜头位置推断营销标签 */
function shotTag(shot: StoryboardShot, total: number): { text: string; color: string } {
  if (shot.shot === 1) return { text: '钩子', color: '#6366f1' }
  if (shot.shot === total) return { text: '转化', color: '#f59e0b' }
  // 中间镜头交替 卖点/证明
  const mid = shot.shot - 2
  return mid % 2 === 0
    ? { text: '卖点', color: '#10b981' }
    : { text: '证明', color: '#14b8a6' }
}

function formatDuration(sec: number | null): string {
  if (!sec) return '00:30'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const VideoPreview = memo(function VideoPreview({
  videoTask,
  parsed,
  sessionTitle,
  onBack,
}: VideoPreviewProps) {
  const [selectedShot, setSelectedShot] = useState<StoryboardShot | null>(
    parsed?.shots[0] ?? null,
  )
  const selectedVersion = parsed?.version ?? 1
  const [editText, setEditText] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)

  const shots = parsed?.shots ?? []
  const total = shots.length

  function handleShotClick(shot: StoryboardShot) {
    setSelectedShot(shot)
  }

  function handleTimeUpdate() {
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  /** 判断某镜头是否正在播放 */
  function isShotActive(shot: StoryboardShot): boolean {
    const nums = shot.time.match(/\d+/g)
    if (!nums || nums.length < 2) return false
    const start = parseInt(nums[0], 10)
    const end = parseInt(nums[1], 10)
    return currentTime >= start && currentTime < end
  }

  return (
    <div className="lj-video-preview">
      {/* 顶部栏 */}
      <div className="lj-vp__topbar">
        <div className="lj-vp__breadcrumb">
          <span className="lj-vp__crumb">{sessionTitle}</span>
          <span className="lj-vp__sep">/</span>
          <span className="lj-vp__crumb lj-vp__crumb--active">视频预览</span>
        </div>
        <div className="lj-vp__topbar-actions">
          <Button icon={<ArrowLeftOutlined />} onClick={onBack} className="lj-btn-ghost">
            返回对话
          </Button>
          {videoTask.generatedVideoUrl && (
            <a href={videoTask.generatedVideoUrl} download target="_blank" rel="noreferrer">
              <Button type="primary" icon={<DownloadOutlined />} className="lj-btn-primary">
                下载视频
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="lj-vp__content">
        {/* 左侧：视频播放器 */}
        <div className="lj-vp__player-side">
          <div className="lj-vp__player">
            {videoTask.generatedVideoUrl ? (
              <video
                ref={videoRef}
                src={videoTask.generatedVideoUrl}
                controls
                onTimeUpdate={handleTimeUpdate}
                className="lj-vp__video"
              />
            ) : (
              <div className="lj-vp__placeholder">
                <PlayCircleFilled className="lj-vp__placeholder-icon" />
              </div>
            )}
            <div className="lj-vp__player-meta">
              {videoTask.ratio && <span>{videoTask.ratio}</span>}
              {videoTask.resolution && <span>· {videoTask.resolution}</span>}
              <span>· {formatDuration(videoTask.duration)}</span>
            </div>
          </div>

          {/* 状态标签 */}
          <div className="lj-vp__status-tags">
            <Tag color="success" className="lj-status-tag">
              <CheckCircleFilled /> 生成成功
            </Tag>
            <Tag className="lj-status-tag">基于脚本 V{selectedVersion}</Tag>
            <Tag className="lj-status-tag">
              使用 {parsed?.shots.length ?? 0} 项素材
            </Tag>
            <Tag className="lj-status-tag">
              {new Date(videoTask.createdAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Tag>
          </div>
        </div>

        {/* 右侧：分镜时间轴 */}
        <div className="lj-vp__timeline-side">
          <div className="lj-vp__timeline-head">
            <h4>分镜时间轴</h4>
            <p>选择镜头可调整画面、配音或字幕</p>
          </div>

          <div className="lj-vp__shots">
            {shots.map((shot) => {
              const tag = shotTag(shot, total)
              const active = selectedShot?.shot === shot.shot
              const playing = isShotActive(shot)
              return (
                <div
                  className={`lj-vp-shot ${active ? 'active' : ''} ${playing ? 'playing' : ''}`}
                  key={shot.shot}
                  onClick={() => handleShotClick(shot)}
                >
                  <div className="lj-vp-shot__time">{shot.time}</div>
                  <div className="lj-vp-shot__body">
                    <div className="lj-vp-shot__title-row">
                      <span className="lj-vp-shot__title">{shot.scene}</span>
                      <Tag
                        style={{
                          color: tag.color,
                          borderColor: tag.color,
                          background: `${tag.color}14`,
                          fontSize: 11,
                          margin: 0,
                          lineHeight: '20px',
                          padding: '0 6px',
                          borderRadius: 4,
                        }}
                      >
                        {tag.text}
                      </Tag>
                    </div>
                    <div className="lj-vp-shot__desc">{shot.visual}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 选中镜头编辑面板 */}
          {selectedShot && (
            <div className="lj-vp-edit">
              <div className="lj-vp-edit__head">
                <ScissorOutlined />
                <span>
                  优化镜头 {selectedShot.shot} · {selectedShot.scene}
                </span>
              </div>
              <Input.TextArea
                rows={3}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="输入优化指令，例如：第一段达人出镜太平，先拍她偷偷看四周，再拿出产品。字幕放大一些。"
                className="lj-vp-edit__input"
              />
              <div className="lj-vp-edit__actions">
                <Button className="lj-btn-ghost" disabled={!editText.trim()}>
                  仅优化选中镜头
                </Button>
                <Button type="primary" className="lj-btn-primary" disabled={!editText.trim()}>
                  更新脚本并重生成
                </Button>
              </div>
              <p className="lj-vp-edit__note">
                本次优化会保留 V1 的其余镜头与素材关联
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
