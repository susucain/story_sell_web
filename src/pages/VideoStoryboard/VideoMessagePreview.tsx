import { useRef, useState } from 'react'
import { AudioOutlined, ClockCircleOutlined, MobileOutlined, PlayCircleFilled, PlayCircleOutlined } from '@ant-design/icons'
import type { ParsedStoryboard, SegmentPreviewContext, StoryboardShot, VideoTaskItem } from './types'
import './video-message-preview.css'
import { MetaTag } from './ScriptCard'
import { getPreviewShots, getPreviewTitle } from './segment-preview'

interface VideoMessagePreviewProps {
  videoTask: VideoTaskItem
  parsed: ParsedStoryboard | null
  segmentContext?: SegmentPreviewContext | null
}

function getShotRange(shot: StoryboardShot): { start: number; end: number } | null {
  const values = shot.time.match(/\d+(?:\.\d+)?/g)
  if (!values || values.length < 2) return null
  const start = Number(values[0])
  const end = Number(values[1])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

function formatDuration(duration: number | null): string {
  if (!duration || duration <= 0) return '未知时长'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function VideoMessagePreview({
  videoTask,
  parsed,
  segmentContext = null,
}: VideoMessagePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [selectedShot, setSelectedShot] = useState<number | null>(null)
  const shots = getPreviewShots(parsed, segmentContext)

  function handleShotClick(shot: StoryboardShot) {
    const range = getShotRange(shot)
    setSelectedShot(shot.shot)
    if (!range || !videoRef.current) return

    videoRef.current.currentTime = range.start
    void videoRef.current.play().catch(() => {
      // Playback can be blocked until the user interacts with the player.
    })
  }

  function isShotPlaying(shot: StoryboardShot): boolean {
    const range = getShotRange(shot)
    return Boolean(range && currentTime >= range.start && currentTime < range.end)
  }

  return (
    <div className="video-message-preview-container">
      <div className="video-message-preview__head">
        <div className="lj-script-card__version">
          视频预览
        </div>
        <h3 className="video-message-preview__title">
          {getPreviewTitle(parsed?.title, segmentContext)}
        </h3>
        <div className="lj-script-card__meta">
          <MetaTag icon={<MobileOutlined />}>脚本 V{parsed?.version ?? 'X'}</MetaTag>
          <MetaTag icon={<ClockCircleOutlined />}>
            {formatDuration(videoTask.duration)}
          </MetaTag>
          <MetaTag icon={<MobileOutlined />}>{videoTask.ratio}</MetaTag>
          <MetaTag icon={<PlayCircleOutlined />}>{videoTask.resolution}</MetaTag>
          {parsed?.character && (
            <MetaTag icon={<AudioOutlined />}>
              {parsed.character.mode === 'user_portrait'
                ? '主角色：用户上传人像'
                : parsed.character.mode === 'preset_avatar'
                  ? `主角色：${parsed.character.presetAlias || parsed.character.roleName || '虚拟人像'}`
                  : '无人物出镜'}
            </MetaTag>
          )}
        </div>
      </div>
      <div className={`video-message-preview ${shots.length > 0 ? '' : 'video-message-preview--player-only'}`}>
        <div className="video-message-preview__player-column">
          <div className="video-message-preview__player">
            {videoTask.generatedVideoUrl ? (
              <video
                ref={videoRef}
                className="video-message-preview__video"
                src={videoTask.generatedVideoUrl}
                controls
                preload="metadata"
                onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              />
            ) : (
              <div className="video-message-preview__placeholder">
                <PlayCircleFilled />
              </div>
            )}
          </div>
        </div>

        {shots.length > 0 && (
          <div className="video-message-preview__timeline">
            <div className="video-message-preview__shots">
              {shots.map((shot) => {
                const selected = selectedShot === shot.shot
                const playing = isShotPlaying(shot)
                return (
                  <button
                    type="button"
                    key={shot.shot}
                    className={`video-message-preview__shot${selected ? ' is-selected' : ''}${playing ? ' is-playing' : ''}`}
                    onClick={() => handleShotClick(shot)}
                  >
                    <span className="video-message-preview__shot-time">{shot.time}</span>
                    <span className="video-message-preview__shot-body">
                      <span className="video-message-preview__shot-title">{shot.scene}</span>
                      {shot.visual && <span className="video-message-preview__shot-desc">{shot.visual}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
