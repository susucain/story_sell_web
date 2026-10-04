import { useState } from 'react'
import { Button, Popconfirm, Radio, Tooltip } from 'antd'
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ScissorOutlined,
  UpOutlined,
} from '@ant-design/icons'
import type {
  GenerationPlanSegment,
  GenerationPlanTask,
  VideoContinuityMode,
  VideoGenerationPlan,
} from './types'
import './segment-plan.css'

interface SegmentPlanPanelProps {
  plan: VideoGenerationPlan
  pending: boolean
  onConfirmNext: (mode: VideoContinuityMode) => void
  onRegenerate: (segmentIndex: number, mode: VideoContinuityMode) => void
  onCancel: () => void
  onDismiss: () => void
}

type SegmentState = 'done' | 'active' | 'failed' | 'pending'

const CONTINUITY_OPTIONS: Array<{ value: VideoContinuityMode; label: string; hint: string }> = [
  { value: 'extend', label: '延长上一段（推荐）', hint: '以已生成成片为底向后延长，动作与运镜最连贯' },
  { value: 'frame_bridge', label: '尾帧作首帧', hint: '用上一段尾帧约束本段首帧，画面更干净但衔接更硬' },
]

const PLAN_STATUS_TEXT: Record<VideoGenerationPlan['status'], string> = {
  planning: '正在规划分段',
  generating: '正在生成当前段',
  awaiting_confirm: '等待确认下一段',
  completed: '全部段已生成',
  failed: '分段生成失败',
  cancelled: '已取消',
}

/** 同一段可能有多条任务（重抽后旧任务被置为 cancelled），取最新的一条非作废任务 */
function findTask(
  tasks: GenerationPlanTask[],
  segmentIndex: number,
): GenerationPlanTask | undefined {
  const matches = tasks.filter((task) => task.segmentIndex === segmentIndex)
  if (matches.length === 0) return undefined
  return matches.filter((task) => task.status !== 'cancelled').pop() ?? matches[matches.length - 1]
}

function resolveState(task: GenerationPlanTask | undefined): SegmentState {
  if (!task) return 'pending'
  if (task.status === 'succeeded') return 'done'
  if (task.status === 'failed' || task.status === 'expired') return 'failed'
  // cancelled 是后端「作废」的终态（重抽后续段、取消计划），语义等同待生成
  if (task.status === 'cancelled') return 'pending'
  return 'active'
}

function stateMeta(state: SegmentState): { text: string; tone: string; icon: React.ReactNode } {
  switch (state) {
    case 'done':
      return { text: '已生成', tone: 'success', icon: <CheckCircleFilled /> }
    case 'active':
      return { text: '生成中', tone: 'generating', icon: <LoadingOutlined /> }
    case 'failed':
      return { text: '生成失败', tone: 'error', icon: <ExclamationCircleOutlined /> }
    default:
      return { text: '待生成', tone: 'waiting', icon: <ClockCircleOutlined /> }
  }
}

function formatRange(segment: GenerationPlanSegment): string {
  return `${segment.startSec.toFixed(1)}s - ${segment.endSec.toFixed(1)}s · ${segment.duration.toFixed(1)}s`
}

export function SegmentPlanPanel({
  plan,
  pending,
  onConfirmNext,
  onRegenerate,
  onCancel,
  onDismiss,
}: SegmentPlanPanelProps) {
  const [mode, setMode] = useState<VideoContinuityMode>('extend')

  const awaitingConfirm = plan.status === 'awaiting_confirm'
  // 后端 assertPlanActive 会拒绝已取消/已完成计划的开始下一段与重抽，前端同步禁用
  const planEditable = plan.status !== 'cancelled' && plan.status !== 'completed'
  const hasActiveTask = plan.tasks.some((task) => (
    task.status === 'queued' || task.status === 'running' || task.status === 'persisting'
  ))
  const busy = pending || hasActiveTask
  const progress = plan.totalSegments > 0
    ? Math.round((plan.completedSegments / plan.totalSegments) * 100)
    : 0

  return (
    <section className={`lj-segplan lj-segplan--${plan.status}`}>
      <header className="lj-segplan__head">
        <div className="lj-segplan__heading">
          <span className="lj-segplan__badge"><ScissorOutlined /> 分段生成</span>
          <span className="lj-segplan__title">{plan.scriptTitle}</span>
        </div>
        <div className="lj-segplan__meta">
          <span className={`lj-segplan__status lj-segplan__status--${plan.status}`}>
            {PLAN_STATUS_TEXT[plan.status]}
          </span>
          {plan.status !== 'completed' && plan.status !== 'cancelled' && (
            <Tooltip title="取消整个分段计划（已完成的分段保留）">
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                disabled={pending}
                onClick={onCancel}
              />
            </Tooltip>
          )}
          <Tooltip title="收起面板（计划仍保留在会话中）">
            <Button type="text" size="small" icon={<UpOutlined />} onClick={onDismiss} />
          </Tooltip>
        </div>
      </header>

      <div className="lj-segplan__progress">
        <div className="lj-segplan__progress-info">
          <span>已生成 {plan.completedSegments}/{plan.totalSegments} 段</span>
          <span>目标时长 {plan.targetDuration}s</span>
        </div>
        <div className="lj-segplan__progress-bar" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      {plan.continuation && (
        <div className="lj-segplan__note">
          第 1 段承接原片（{plan.continuation.sourceDurationSec}s · {plan.continuation.continuityMode === 'frame_bridge' ? '尾帧作首帧' : '延长上一段'}），进度仅统计续写部分。
        </div>
      )}

      <div className="lj-segplan__segments">
        {plan.segments.map((segment) => {
          const task = findTask(plan.tasks, segment.index)
          const state = resolveState(task)
          const meta = stateMeta(state)
          const isBoundary = awaitingConfirm && segment.index === plan.completedSegments
          return (
            <article key={segment.index} className={`lj-segplan__segment lj-segplan__segment--${meta.tone}`}>
              <div className="lj-segplan__segment-head">
                <span className="lj-segplan__segment-index">第 {segment.index} 段</span>
                <span className="lj-segplan__segment-status">
                  {meta.icon} {meta.text}
                </span>
              </div>
              <div className="lj-segplan__segment-meta">
                {formatRange(segment)} · {segment.shotCount} 个镜头
                {task?.continuityMode === 'frame_bridge' && segment.index > 1 && ' · 尾帧作首帧'}
              </div>

              {state === 'active' && (
                <div className="lj-segplan__segment-body lj-segplan__segment-body--active">
                  <LoadingOutlined /> 正在生成这一段，完成后可确认继续
                </div>
              )}

              {task?.errorMessage && state === 'failed' && (
                <div className="lj-segplan__segment-body lj-segplan__segment-body--error">
                  {task.errorMessage}
                </div>
              )}

              {state === 'done' && task?.generatedVideoUrl && (
                <video
                  className="lj-segplan__video"
                  src={task.generatedVideoUrl}
                  poster={task.lastFrameUrl ?? undefined}
                  controls
                  preload="metadata"
                />
              )}

              {isBoundary && (
                <div className="lj-segplan__confirm">
                  <div className="lj-segplan__confirm-label">选择下一段的衔接方式</div>
                  <Radio.Group
                    className="lj-segplan__mode"
                    value={mode}
                    onChange={(event) => setMode(event.target.value as VideoContinuityMode)}
                    disabled={busy}
                  >
                    {CONTINUITY_OPTIONS.map((option) => (
                      <Radio key={option.value} value={option.value}>
                        <Tooltip title={option.hint}>{option.label}</Tooltip>
                      </Radio>
                    ))}
                  </Radio.Group>
                  <Button
                    type="primary"
                    className="lj-btn-primary"
                    icon={<PlayCircleOutlined />}
                    loading={pending}
                    disabled={busy}
                    onClick={() => onConfirmNext(mode)}
                  >
                    确认，继续下一段
                  </Button>
                </div>
              )}

              {(state === 'done' || state === 'failed') && planEditable && (
                <div className="lj-segplan__segment-actions">
                  {segment.index < plan.completedSegments ? (
                    <Popconfirm
                      title="重抽这一段"
                      description="已生成的后续分段会作废并需要重新生成，确定继续吗？"
                      okText="重抽"
                      cancelText="取消"
                      onConfirm={() => onRegenerate(segment.index, task?.continuityMode ?? 'extend')}
                    >
                      <Button
                        size="small"
                        className="lj-btn-ghost"
                        icon={<ReloadOutlined />}
                        disabled={busy}
                      >
                        重抽本段
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      size="small"
                      className="lj-btn-ghost"
                      icon={<ReloadOutlined />}
                      disabled={busy}
                      onClick={() => onRegenerate(segment.index, task?.continuityMode ?? 'extend')}
                    >
                      重抽本段
                    </Button>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {plan.status === 'completed' && (
        <footer className="lj-segplan__footer">
          <CheckCircleFilled /> 全部 {plan.totalSegments} 段已生成。本期不自动拼接，请分别下载各段后自行剪辑。
        </footer>
      )}
    </section>
  )
}
