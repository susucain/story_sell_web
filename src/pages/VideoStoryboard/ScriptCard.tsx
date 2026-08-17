import { memo } from 'react'
import { Button, Tag } from 'antd'
import {
  ClockCircleOutlined,
  PlayCircleOutlined,
  AudioOutlined,
  MobileOutlined,
} from '@ant-design/icons'
import type { ParsedStoryboard, AssetItem } from './types'

interface ScriptCardProps {
  parsed: ParsedStoryboard
  assets: AssetItem[]
  isStreaming?: boolean
  onQuoteScript?: () => void
  onGenerateVideo?: () => void
  generating?: boolean
}

export function MetaTag({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="lj-meta-tag">
      {icon}
      {children}
    </span>
  )
}

export const ScriptCard = memo(function ScriptCard({
  parsed,
  assets,
  isStreaming = false,
  onQuoteScript,
  onGenerateVideo,
  generating = false,
}: ScriptCardProps) {
  const videoEdit = parsed.edit?.mode === 'full_video_edit' ? parsed.edit : undefined
  const sourceVideo = videoEdit
    ? assets.find((asset) => asset.id === videoEdit.sourceAssetId)
    : undefined
  const analysisAssets = assets.filter((a) => a.assetPurpose === 'analysis')
  const imageCount = analysisAssets.filter((a) => a.assetType === 'image').length
  const videoCount = analysisAssets.filter((a) => a.assetType === 'video').length

  const assetText: string[] = []
  if (imageCount > 0) assetText.push(`商品主图 ×${imageCount}`)
  if (videoCount > 0) assetText.push(`参考视频 ×${videoCount}`)
  if (sourceVideo) assetText.push(`原视频：${sourceVideo.name}`)

  return (
    <div className="lj-script-card">
      {/* 头部 */}
      <div className="lj-script-card__header">
        <div className="lj-script-card__version">
          {videoEdit ? '视频修改任务' : '视频分镜脚本'} · V{parsed.version}
        </div>
        <h3 className="lj-script-card__title">{parsed.title}</h3>
        {parsed.description && (
          <p className="lj-script-card__desc">{parsed.description}</p>
        )}
        <div className="lj-script-card__meta">
          {parsed.totalDuration > 0 && (
            <MetaTag icon={<ClockCircleOutlined />}>
              {videoEdit ? `输出 ${parsed.totalDuration} 秒` : `${parsed.totalDuration} 秒`}
            </MetaTag>
          )}
          {videoEdit && (
            <MetaTag icon={<ClockCircleOutlined />}>
              修改 {videoEdit.targetStartSec}s-{videoEdit.targetEndSec}s
            </MetaTag>
          )}
          <MetaTag icon={<MobileOutlined />}>{parsed.ratio} 竖版</MetaTag>
          <MetaTag icon={<AudioOutlined />}>{parsed.style}</MetaTag>
          <MetaTag icon={<PlayCircleOutlined />}>{parsed.platform}</MetaTag>
          {parsed.character && (
            <MetaTag icon={<PlayCircleOutlined />}>
              {parsed.character.mode === 'user_portrait'
                ? '主角色：用户上传人像'
                : parsed.character.mode === 'preset_avatar'
                  ? `主角色：${parsed.character.presetAlias || parsed.character.roleName || '虚拟人像'}`
                  : '无人物出镜'}
            </MetaTag>
          )}
        </div>
      </div>

      {/* 镜头表格 */}
      <div className="lj-script-card__table">
        <div className="lj-shot-table">
          {parsed.shots.map((shot) => (
            <div className="lj-shot-table__row" key={shot.shot}>
              <div className="lj-shot-col lj-shot-col--num">
                <span className="lj-shot-num">{String(shot.shot).padStart(2, '0')}</span>
              </div>
              <div className="lj-shot-col lj-shot-col--time">{shot.time}</div>
              <div className="lj-shot-col lj-shot-col--scene">
                <div className="lj-shot-title">{shot.scene}</div>
                <div className="lj-shot-visual">{shot.visual}</div>
              </div>
              <div className="lj-shot-col lj-shot-col--audio">
                <div className="lj-shot-audio-label">口播 / 字幕</div>
                {shot.audio && (
                  <span className="lj-shot-vo">"{shot.audio}"</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 关联素材 */}
      {assetText.length > 0 && (
        <div className="lj-script-card__assets">
          <span className="lj-script-card__assets-label">关联素材</span>
          {assetText.map((t) => (
            <Tag key={t} className="lj-asset-pill">{t}</Tag>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      {!isStreaming && (
        <div className="lj-script-card__actions">
          <Button className="lj-btn-ghost" onClick={onQuoteScript}>
            引用脚本修改
          </Button>
          <Button
            type="primary"
            className="lj-btn-primary"
            onClick={onGenerateVideo}
            loading={generating}
          >
            {videoEdit ? '生成修改后视频' : '使用该脚本生成视频'}
          </Button>
        </div>
      )}
    </div>
  )
})
