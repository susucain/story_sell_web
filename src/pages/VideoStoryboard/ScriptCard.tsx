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

function MetaTag({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
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
  const imageCount = assets.filter((a) => a.type === 'image').length
  const videoCount = assets.filter((a) => a.type === 'video').length

  const assetText: string[] = []
  if (imageCount > 0) assetText.push(`商品主图 ×${imageCount}`)
  if (videoCount > 0) assetText.push(`参考视频 ×${videoCount}`)

  return (
    <div className="lj-script-card">
      {/* 头部 */}
      <div className="lj-script-card__header">
        <div className="lj-script-card__version">视频分镜脚本 V1</div>
        <h3 className="lj-script-card__title">{parsed.title}</h3>
        {parsed.description && (
          <p className="lj-script-card__desc">{parsed.description}</p>
        )}
        <div className="lj-script-card__meta">
          {parsed.totalDuration > 0 && (
            <MetaTag icon={<ClockCircleOutlined />}>{parsed.totalDuration} 秒</MetaTag>
          )}
          <MetaTag icon={<MobileOutlined />}>9:16 竖版</MetaTag>
          <MetaTag icon={<AudioOutlined />}>真实口播</MetaTag>
          <MetaTag icon={<PlayCircleOutlined />}>抖音/小红书</MetaTag>
        </div>
      </div>

      {/* 镜头表格 */}
      <div className="lj-script-card__table">
        <div className="lj-shot-table">
          <div className="lj-shot-table__head">
            <div className="lj-shot-col lj-shot-col--num">镜头</div>
            <div className="lj-shot-col lj-shot-col--time">时间</div>
            <div className="lj-shot-col lj-shot-col--title">场景标题</div>
            <div className="lj-shot-col lj-shot-col--visual">画面描述</div>
            <div className="lj-shot-col lj-shot-col--audio">音频/字幕</div>
          </div>
          {parsed.shots.map((shot) => (
            <div className="lj-shot-table__row" key={shot.number}>
              <div className="lj-shot-col lj-shot-col--num">
                <span className="lj-shot-num">{String(shot.number).padStart(2, '0')}</span>
              </div>
              <div className="lj-shot-col lj-shot-col--time">{shot.timeRange}</div>
              <div className="lj-shot-col lj-shot-col--title">
                <span className="lj-shot-title">{shot.title}</span>
              </div>
              <div className="lj-shot-col lj-shot-col--visual">
                {shot.visualDescription}
              </div>
              <div className="lj-shot-col lj-shot-col--audio">
                {shot.voiceover && (
                  <span className="lj-shot-vo">"{shot.voiceover}"</span>
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
            使用该脚本生成视频
          </Button>
        </div>
      )}
    </div>
  )
})
