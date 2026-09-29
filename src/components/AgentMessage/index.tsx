import { memo, useState } from 'react'
import {
  getToolName,
  isToolUIPart,
  type UIMessage,
} from 'ai'
import {
  CheckCircleOutlined,
  LoadingOutlined,
  ToolOutlined,
  FileTextOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  SendOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import { Button, Image } from 'antd'
import { StreamdownText } from '../StreamdownText'
import { ScriptCard } from '../../pages/VideoStoryboard/ScriptCard'
import { VideoMessagePreview } from '../../pages/VideoStoryboard/VideoMessagePreview'
import type { ScriptVersion, AssetItem, VideoTaskItem } from '../../pages/VideoStoryboard/types'
import { toParsedStoryboard } from '../../pages/VideoStoryboard/types'
import type { ProcessPhase, ProcessState, ProcessStatePart } from './process-types'
import './style.css'

type AnyToolPart = Extract<UIMessage['parts'][number], { type: `tool-${string}` } | { type: 'dynamic-tool' }>

/** 工具名 → 友好展示名 */
const FRIENDLY_TOOL_NAMES: Record<string, string> = {
  task: '委派子任务',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '编辑文件',
  ls: '列出目录',
  glob: '搜索文件',
  grep: '搜索内容',
  execute: '执行命令',
  write_todos: '更新进度',
}

function friendlyToolName(name: string): string {
  return FRIENDLY_TOOL_NAMES[name] ?? name
}

/** 工具名 → 图标 */
const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_file: <FileTextOutlined />,
  write_file: <FileAddOutlined />,
  edit_file: <FileTextOutlined />,
  ls: <FolderOpenOutlined />,
  glob: <SearchOutlined />,
  grep: <SearchOutlined />,
  execute: <CodeOutlined />,
  task: <SendOutlined />,
  write_todos: <ThunderboltOutlined />,
}

function getToolIcon(name: string): React.ReactNode {
  return TOOL_ICONS[name] ?? <ToolOutlined />
}

/** 从工具 input 提取一行摘要 */
function summarizeToolInput(name: string, input: unknown): string | undefined {
  if (input == null || typeof input !== 'object') {
    if (typeof input === 'string' && input.trim()) return input
    return undefined
  }
  const obj = input as Record<string, unknown>
  if (name === 'task') {
    const sub = typeof obj.subagent_type === 'string' ? obj.subagent_type : ''
    const desc = typeof obj.description === 'string' ? obj.description : ''
    if (sub && desc) return `${sub} · ${truncate(desc, 48)}`
    if (sub) return sub
    if (desc) return truncate(desc, 60)
    return undefined
  }
  // 文件类工具：显示 basename
  for (const key of ['file_path', 'path']) {
    const v = obj[key]
    if (typeof v === 'string' && v) {
      const segs = v.replace(/\\/g, '/').split('/').filter(Boolean)
      const tail = segs.slice(-2).join('/')
      return tail || v
    }
  }
  if (name === 'glob' && typeof obj.pattern === 'string') return obj.pattern
  if (name === 'grep' && typeof obj.pattern === 'string') return truncate(obj.pattern, 48)
  return undefined
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > n ? t.slice(0, n) + '…' : t
}

function fullToolInputPath(input: unknown): string | undefined {
  if (input == null || typeof input !== 'object') return undefined
  const obj = input as Record<string, unknown>
  for (const key of ['file_path', 'path']) {
    const v = obj[key]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

/** 生成工具输出的简略描述（不展示完整内容） */
function summarizeToolOutput(name: string, output: unknown): string | undefined {
  if (output == null) return undefined
  if (typeof output === 'string') {
    // read_file 等返回字符串内容，只显示长度
    if (name === 'read_file') {
      const len = output.length
      if (len > 1000) return `已读取 ${Math.round(len / 1024)}KB 内容`
      return `已读取 ${len} 字符`
    }
    // write_file 返回成功信息，提取路径
    const match = output.match(/wrote to '([^']+)'/)
    if (match) {
      const segs = match[1].replace(/\\/g, '/').split('/').filter(Boolean)
      return `已写入 ${segs.slice(-2).join('/')}`
    }
    const short = truncate(output, 80)
    return short || undefined
  }
  if (typeof output === 'object') {
    const str = JSON.stringify(output)
    if (str.length > 200) return `输出 ${Math.round(str.length / 1024)}KB`
    return truncate(str, 80) || undefined
  }
  return String(output)
}

/** 单个工具调用的简略展示条 */
function ToolStep({ part, isStreaming }: { part: AnyToolPart; isStreaming?: boolean }) {
  const name = getToolName(part as any)
  const rawState = 'state' in part ? (part as any).state : 'input-streaming'
  const isError = rawState === 'output-error' || rawState === 'output-denied'
  // 流式结束后，非错误状态的工具调用一律视为已完成（修复 loading 态卡住问题）
  const isDone = !isStreaming && !isError
    ? true
    : rawState === 'output-available'

  const input = 'input' in part ? (part as any).input : undefined
  const output = 'output' in part ? (part as any).output : undefined
  const summary = summarizeToolInput(name, input)
  const fullPath = fullToolInputPath(input)
  const outputSummary = summarizeToolOutput(name, output)

  const statusIcon = isError ? (
    <span className="tool-step__icon tool-step__icon--error">✕</span>
  ) : isDone ? (
    <CheckCircleOutlined className="tool-step__icon tool-step__icon--done" />
  ) : (
    <LoadingOutlined className="tool-step__icon tool-step__icon--loading" />
  )

  const statusText = isError ? '失败' : isDone ? '已完成' : '执行中'

  return (
    <div className={`tool-step${isError ? ' tool-step--error' : ''}`} title={fullPath}>
      {statusIcon}
      <span className="tool-step__tool-icon">{getToolIcon(name)}</span>
      <span className="tool-step__name">{friendlyToolName(name)}</span>
      {summary ? <span className="tool-step__summary">{summary}</span> : null}
      {isDone && outputSummary ? <span className="tool-step__output-summary">{outputSummary}</span> : null}
      <span className="tool-step__status">{statusText}</span>
    </div>
  )
}

/** 可折叠的工具步骤面板 */
function CollapsibleToolSteps({ children, total, label }: { children: React.ReactNode; total: number; label?: string }) {
  const [expanded, setExpanded] = useState(false)

  if (total === 0) return null

  return (
    <div className="collapsible-tool-steps">
      <div className="collapsible-tool-steps__header" onClick={() => setExpanded(!expanded)}>
        <span className="collapsible-tool-steps__arrow">{expanded ? '' : '▸'}</span>
        <ToolOutlined className="collapsible-tool-steps__icon" />
        <span className="collapsible-tool-steps__label">
          {label ?? `${total} 个工具调用`}
        </span>
        <span className="collapsible-tool-steps__count">{expanded ? '收起' : '展开'}</span>
      </div>
      {expanded && <div className="collapsible-tool-steps__body">{children}</div>}
    </div>
  )
}

function useProcessState(parts: UIMessage['parts']): ProcessState | null {
  const statePart = [...parts]
    .reverse()
    .find((p: any) => p.type === 'data-process-state') as ProcessStatePart | undefined
  if (!statePart) return null
  if (statePart.data.status === 'skipped') return null
  return statePart.data
}

function formatDuration(ms?: number): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

/** 创作过程面板：按设计稿渲染三阶段时间线 */
function ProcessPanel({ parts, isStreaming }: { parts: UIMessage['parts']; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(true)
  const state = useProcessState(parts)
  if (!state || state.phases.length === 0) return null

  // const completedPhases = state.phases.filter((p) => p.status === 'completed').length
  const operationCount = state.phases.reduce((sum, phase) => {
    return (
      sum +
      (phase.items?.length ?? 0) +
      (phase.cards?.length ?? 0) +
      (phase.actions?.length ?? 0)
    )
  }, 0)

  const isRunning = state.status === 'running' || isStreaming
  const isWaitingForUser = state.status === 'waiting_for_user'

  return (
    <div className="process-panel">
      <div className="process-header">
        <div className="process-header__left">
          <div className="process-icon">⚡</div>
          <div>
            <div className="process-title">本次创作过程</div>
            <div className="process-meta">
              {state.phases.length} 个阶段 · 共 {operationCount} 项操作
            </div>
          </div>
        </div>
        <div className="process-header__right">
          <span className={`process-status ${isRunning ? 'running' : isWaitingForUser ? 'waiting' : ''}`}>
            {isRunning ? (
              <>
                <span className="pulse-dot" /> 进行中
              </>
            ) : isWaitingForUser ? (
              <>等待你的确认</>
            ) : (
              <>
                <CheckIcon className="process-status__icon" /> 创作完成
              </>
            )}
          </span>
          <button type="button" className="toggle-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起 ▲' : '展开 ▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="process-body">
          <div className="steps">
            {state.phases.map((phase, index) => (
              <ProcessPhaseView key={phase.id} phase={phase} index={index + 1} isRunning={isRunning} />
            ))}
            {/* <TimelineProgress completed={completedPhases} total={state.phases.length} /> */}
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineProgress({ completed, total }: { completed: number; total: number }) {
  const percent = total === 0 ? 0 : (completed / total) * 100
  return (
    <style>{`
      .steps::before {
        background: linear-gradient(to bottom, var(--pp-primary) ${percent}%, var(--pp-border) ${percent}%);
      }
    `}</style>
  )
}

function ProcessPhaseView({
  phase,
  index,
  isRunning,
}: {
  phase: ProcessPhase
  index: number
  isRunning: boolean
}) {
  const done = phase.status === 'completed'
  const running = phase.status === 'running'
  const waiting = phase.status === 'waiting_for_user'
  const duration = phase.endTime && phase.startTime ? phase.endTime - phase.startTime : undefined

  return (
    <div className={`step ${done ? 'done' : running ? 'running' : waiting ? 'waiting' : ''}`}>
      <div className="step-marker">{done ? <CheckIcon className="step-marker__icon" /> : waiting ? '?' : index}</div>
      <div className="step-content">
        <div className="step-header">
          <div>
            <div className="step-name">{phase.title}</div>
            <div className="step-desc">{phase.description}</div>
          </div>
          <span className="step-time">
            {done ? formatDuration(duration) : running ? '进行中' : waiting ? '等待确认' : '等待中'}
          </span>
        </div>

        {phase.items && phase.items.length > 0 && (
          <div className="step-children">
            {phase.items.map((item) => (
              <div className={`child-item ${item.status}`} key={item.id}>
                {item.status === 'completed' ? (
                  <CheckIcon className="child-icon success" />
                ) : item.status === 'running' ? (
                  <span className="spinner" />
                ) : (
                  <FileIcon className="child-icon pending" />
                )}
                <div className="child-body">
                  <span className="child-title">
                    {item.title}
                    {item.tag && <span className="child-tag">{item.tag.text}</span>}
                  </span>
                  {item.description && <div className="child-sub">{item.description}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {phase.cards && phase.cards.length > 0 && (
          <div className="capability-list">
            {phase.cards.map((card) => (
              <div className="capability-item" key={card.id}>
                <div
                  className="capability-icon"
                  style={{ background: card.iconBg, color: card.iconColor }}
                >
                  {card.icon}
                </div>
                <div className="capability-body">
                  <div className="capability-title">{card.title}</div>
                  <div className="capability-sub">{card.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {((phase.actions?.length ?? 0) + (phase.outputs?.length ?? 0)) > 0 && (
          <GeneratePhaseBody phase={phase} isRunning={isRunning} />
        )}
      </div>
    </div>
  )
}

function GeneratePhaseBody({ phase, isRunning }: { phase: ProcessPhase; isRunning: boolean }) {
  const actions = phase.actions ?? []
  const outputs = phase.outputs ?? []
  const allDone = phase.status === 'completed'
  const anyRunning = actions.some((a) => a.status === 'running') || phase.status === 'running'
  const anyWaiting = actions.some((a) => a.status === 'waiting_for_user')

  const generateAction = actions.find((a) => a.id === 'generate-script-action')

  return (
    <div className="step-children">
      {anyRunning && outputs.length === 0 && generateAction && (
        <div className="current-action">
          <span className="spinner" />
          <span>正在{generateAction.title}...</span>
        </div>
      )}

      {(allDone || anyWaiting || outputs.length > 0) && (
        <>
          {actions.map((action) => (
            <div className={`child-item ${action.status}`} key={action.id}>
              {action.status === 'completed' ? (
                <CheckIcon className="child-icon success" />
              ) : action.status === 'running' ? (
                <span className="spinner" />
              ) : action.status === 'waiting_for_user' ? (
                <span className="child-icon pending">?</span>
              ) : (
                <FileIcon className="child-icon pending" />
              )}
              <div className="child-body">
                <span className="child-title">{action.title}</span>
                {action.description && <div className="child-sub">{action.description}</div>}
              </div>
            </div>
          ))}
          {outputs.map((output, i) => (
            <div className="output-card" key={i}>
              <div className="output-card__title">
                <FileIcon className="output-card__icon" />
                {output.title}
              </div>
              <div className="output-tags">
                {output.tags.map((tag, idx) => (
                  <span className="output-tag" key={idx}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {anyRunning && outputs.length === 0 && (
        <div className="generate-skeleton">
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text short" />
        </div>
      )}
    </div>
  )
}

/**
 * 拆分 assistant 消息的 parts：
 * - mainToolParts：主 agent 的工具调用（按出现顺序）
 * - subAgentSections：子 agent 的工具调用分组（每个 task 工具调用对应一个子 agent section）
 * - finalTextParts：主 agent 的最终文本输出（排除子 agent 的文本）
 * - reasoningParts：思考过程
 *
 * 子 agent 的工具调用通过 task 工具调用来识别：
 * - task 工具调用标志着子 agent 的开始
 * - task 之后的非 task 工具调用属于该子 agent
 * - 下一个 task 工具调用或主 agent 工具调用标志着子 agent 的结束
 */
function splitAssistantParts(parts: UIMessage['parts']) {
  const mainToolParts: AnyToolPart[] = []
  const reasoningParts: { type: string; text: string }[] = []
  const subAgentSections: { taskPart: AnyToolPart; toolParts: AnyToolPart[] }[] = []

  let currentSubAgent: { taskPart: AnyToolPart; toolParts: AnyToolPart[] } | null = null

  parts.forEach((part) => {
    if (isToolUIPart(part as any)) {
      const toolPart = part as AnyToolPart
      const name = getToolName(toolPart as any)

      if (name === 'task') {
        // 保存之前的子 agent section（如果有）
        if (currentSubAgent) {
          subAgentSections.push(currentSubAgent)
        }
        // 开始新的子 agent section
        currentSubAgent = { taskPart: toolPart, toolParts: [] }
      } else if (currentSubAgent) {
        // 非 task 工具调用，如果当前在子 agent 中，则归入子 agent
        currentSubAgent.toolParts.push(toolPart)
      } else {
        // 主 agent 的工具调用
        mainToolParts.push(toolPart)
      }
    }

    if (part.type === 'reasoning' && 'text' in part) {
      reasoningParts.push({ type: 'reasoning', text: (part as any).text })
    }
  })

  // 保存最后一个子 agent section（如果有）
  if (currentSubAgent) {
    subAgentSections.push(currentSubAgent)
  }

  // 主 agent 的最终文本：排除子 agent 的文本
  // 子 agent 的文本出现在 task 工具调用之后，下一个主 agent 工具调用或消息结束之前
  const finalTextParts: UIMessage['parts'] = []
  let inSubAgent = false
  let lastToolIdx = -1

  // 找到最后一个主 agent 工具调用的索引
  parts.forEach((part, idx) => {
    if (isToolUIPart(part as any)) {
      const name = getToolName(part as any)
      if (name !== 'task' && !inSubAgent) {
        lastToolIdx = idx
      }
    }
  })

  parts.forEach((part, idx) => {
    if (part.type !== 'text') return

    // 检查是否在子 agent 范围内
    if (parts[idx - 1] && isToolUIPart(parts[idx - 1] as any)) {
      const prevName = getToolName(parts[idx - 1] as any)
      if (prevName === 'task') {
        inSubAgent = true
      }
    }

    // 如果遇到主 agent 的工具调用，退出子 agent 范围
    if (parts[idx + 1] && isToolUIPart(parts[idx + 1] as any)) {
      const nextName = getToolName(parts[idx + 1] as any)
      if (nextName !== 'task') {
        inSubAgent = false
      }
    }

    // 只收集主 agent 的最终文本
    if (!inSubAgent && (lastToolIdx === -1 || idx > lastToolIdx)) {
      finalTextParts.push(part)
    }
  })

  return { mainToolParts, subAgentSections, finalTextParts, reasoningParts }
}

interface VideoGenerationMetadata {
  kind: 'video_generation_submitted' | 'video_generation_result'
  taskId: string
  scriptId?: number
  status: VideoTaskItem['status']
  generatedVideoUrl?: string
  errorMessage?: string
  duration?: number
  ratio?: string
  resolution?: string
}

function getVideoGenerationMetadata(message: UIMessage): VideoGenerationMetadata | null {
  const metadata = message.metadata as Partial<VideoGenerationMetadata> | undefined
  if (
    !metadata
    || (metadata.kind !== 'video_generation_submitted'
      && metadata.kind !== 'video_generation_result')
    || typeof metadata.taskId !== 'string'
  ) {
    return null
  }
  return metadata as VideoGenerationMetadata
}

function VideoGenerationMessageCard({
  metadata,
  task,
  script,
  onReferenceVideo,
  isFocused,
}: {
  metadata: VideoGenerationMetadata
  task?: VideoTaskItem
  script?: ScriptVersion
  onReferenceVideo?: (task: VideoTaskItem) => void
  isFocused?: boolean
}) {
  const status = task?.status ?? metadata.status
  const videoUrl = task?.generatedVideoUrl ?? metadata.generatedVideoUrl
  const errorMessage = task?.errorMessage ?? metadata.errorMessage
  const isSucceeded = status === 'succeeded' && Boolean(videoUrl)
  const isPending = status === 'queued' || status === 'running' || status === 'persisting'
  const isFailed = !isSucceeded && !isPending
  const title = isSucceeded
    ? '视频已生成'
    : status === 'persisting'
      ? '正在保存视频'
    : isPending
      ? '视频生成中'
      : '视频生成未完成'

  return (
    <div
      className={`video-generation-card video-generation-card--${status}${isFocused ? ' is-focused' : ''}`}
      data-video-task-id={metadata.taskId}
    >
      {isSucceeded && task ? (
        <>
          <VideoMessagePreview
            videoTask={task}
            parsed={script ? toParsedStoryboard(script) : null}
          />
          <div className="video-generation-card__actions">
            <Button
              onClick={() => onReferenceVideo?.(task)}
              className="lj-btn-ghost"
            >
              引用视频修改
            </Button>
            <a href={videoUrl} download target="_blank" rel="noreferrer">
              <Button type="primary" icon={<DownloadOutlined />} className="lj-btn-primary">下载</Button>
            </a>
          </div>
        </>
      ) : (
        <div className="video-generation-card__head">
          <span className="video-generation-card__icon">
            {isPending ? <LoadingOutlined spin /> : <ExclamationCircleOutlined />}
          </span>
          <div>
            <div className="video-generation-card__title">{title}</div>
            <div className="video-generation-card__meta">
              {metadata.scriptId ? `基于脚本 #${metadata.scriptId}` : '视频生成任务'}
              {task?.ratio && ` · ${task.ratio}`}
              {task?.resolution && ` · ${task.resolution}`}
            </div>
          </div>
        </div>
      )}
      {isPending && (
        <div className="video-generation-card__progress">
          {status === 'persisting'
            ? '视频已生成，正在保存到工作区。'
            : '任务已提交，完成后将在这里显示视频。'}
        </div>
      )}
      {isFailed && <div className="video-generation-card__error">{errorMessage || '视频任务未能完成，请重新生成。'}</div>}
    </div>
  )
}

export interface AgentMessageProps {
  message: UIMessage
  isStreaming?: boolean
  /** 非流式状态下，对最终文本调用此函数；返回非 null 则用自定义渲染替代 StreamdownText */
  renderFinalText?: (text: string) => React.ReactNode | null
  /** 当前消息关联的脚本版本（优先使用）；未传入时从消息 tool/metadata 中解析 */
  script?: ScriptVersion | null
  /** 当前会话所有脚本版本，用于在生成脚本的消息中内嵌 ScriptCard */
  scripts?: ScriptVersion[]
  /** 当前会话素材，传递给 ScriptCard 显示关联素材 */
  assets?: AssetItem[]
  /** 是否为当前会话最后一条可见的 assistant 消息；只有这条消息才渲染创作过程条 */
  isLatestAssistant?: boolean
  /** 引用脚本 */
  onQuoteScript?: (script: ScriptVersion) => void
  /** 使用脚本生成视频 */
  onGenerateVideo?: (scriptId?: number) => void
  /** 视频生成中状态 */
  generating?: boolean
  /** 当前会话视频任务，用于从任务消息解析最新状态 */
  videos?: VideoTaskItem[]
  /** 将已生成视频作为下一次生成的参考素材 */
  onReferenceVideo?: (task: VideoTaskItem) => void
  /** 右侧视频任务卡定位到的消息 */
  focusedVideoTaskId?: string
}

export const AgentMessage = memo(function AgentMessage({
  message,
  isStreaming = false,
  renderFinalText,
  script: explicitScript,
  scripts = [],
  assets = [],
  isLatestAssistant = false,
  onQuoteScript,
  onGenerateVideo,
  generating = false,
  videos = [],
  onReferenceVideo,
  focusedVideoTaskId,
}: AgentMessageProps) {
  // user 角色
  if (message.role !== 'assistant') {
    const textParts = message.parts.filter((part) => part.type === 'text')
    const fileParts = message.parts.filter((part) => part.type === 'file')
    return (
      <div className="storyboard-row storyboard-row--user">
        <div className="storyboard-bubble storyboard-bubble--user">
          <div className="storyboard-content">
            {textParts.map((part, i) => (
              <div key={`text-${i}`} className="storyboard-text">{part.text}</div>
            ))}
            {fileParts.length > 0 && (
              <div className="storyboard-files">
                {fileParts.map((part, i) => (
                  <div key={`file-${i}`} className="storyboard-file">
                  {(part as any).mediaType?.startsWith('video/') ? (
                    <video src={part.url} muted className="storyboard-file__media" />
                  ) : (
                    <Image src={part.url} alt="reference" className="storyboard-file__media" preview />
                  )}
                  {(part as any).filename && (
                    <div className="storyboard-file__name">{(part as any).filename}</div>
                  )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="storyboard-avatar storyboard-avatar--user">你</div>
      </div>
    )
  }

  const videoMetadata = getVideoGenerationMetadata(message)
  if (videoMetadata) {
    const task = videos.find((item) => item.taskId === videoMetadata.taskId)
    const scriptId = task?.scriptId ?? videoMetadata.scriptId
    const script = scriptId
      ? scripts.find((item) => item.id === scriptId)
      : undefined
    return (
      <div className="storyboard-row storyboard-row--assistant">
        <div className="storyboard-avatar storyboard-avatar--assistant"></div>
        <div className="storyboard-bubble storyboard-bubble--assistant">
          <VideoGenerationMessageCard
            metadata={videoMetadata}
            task={task}
            script={script}
            onReferenceVideo={onReferenceVideo}
            isFocused={focusedVideoTaskId === videoMetadata.taskId}
          />
        </div>
      </div>
    )
  }

  // assistant 角色
  const { mainToolParts, subAgentSections, finalTextParts } = splitAssistantParts(message.parts)
  const lastTextIdx = finalTextParts.length - 1

  // 优先使用外部传入的 script；否则从消息 metadata 或 tool-call 输出中解析 script_id
  const generatedScriptId =
    explicitScript?.id ??
    ((message.metadata as any)?.scriptId as number | undefined) ??
    message.parts
      ?.filter((p: any) => isToolUIPart(p))
      .map((p: any) => {
        if (getToolName(p as any) !== 'generate_script') return null
        const output = (p as any).output
        return output && typeof output === 'object' ? output.script_id : null
      })
      .find((id): id is number => typeof id === 'number')

  const embeddedScript = explicitScript
    ? explicitScript
    : generatedScriptId
      ? scripts.find((s) => s.id === generatedScriptId) ?? null
      : null

  // 过滤掉仅包含 data-process-* / step-start 等无可见内容的 assistant 占位消息
  const hasVisibleContent =
    mainToolParts.length > 0 ||
    subAgentSections.length > 0 ||
    finalTextParts.some((p) => p.type === 'text' && (p as any).text?.trim().length > 0) ||
    embeddedScript != null

  if (!hasVisibleContent) {
    return null
  }

  return (
    <>
      <div className="storyboard-row storyboard-row--assistant">
        <div className="storyboard-avatar storyboard-avatar--assistant"></div>
        <div className="storyboard-bubble storyboard-bubble--assistant">
          <div className="storyboard-content">
            {/* 创作过程面板：只在最后一条可见 assistant 消息中展示一次 */}
            {isLatestAssistant && <ProcessPanel parts={message.parts} isStreaming={isStreaming} />}

            {/* 最终文本（仅主 agent） */}
            {finalTextParts.map((part, i) => {
              if (part.type !== 'text') return null
              // 非流式时尝试自定义渲染（如分镜脚本卡片）
              if (!isStreaming && renderFinalText) {
                const custom = renderFinalText(part.text)
                if (custom !== null && custom !== undefined) {
                  return <div key={i} className="storyboard-custom-render">{custom}</div>
                }
              }
              return (
                <div key={i} className="storyboard-text">
                  <StreamdownText
                    isStreaming={isStreaming && i === lastTextIdx}
                    unwrapMarkdownFences
                  >
                    {part.text}
                  </StreamdownText>
                </div>
              )
            })}
            {/* 脚本卡片：作为生成脚本消息的一部分在气泡底部内嵌展示 */}
            {embeddedScript && !isStreaming && (
              <div className="storyboard-embedded-card">
                <ScriptCard
                  parsed={toParsedStoryboard(embeddedScript)}
                  assets={assets}
                  onQuoteScript={() => onQuoteScript?.(embeddedScript)}
                  onGenerateVideo={() => onGenerateVideo?.(embeddedScript.id)}
                  generating={generating}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}, (prev, next) => {
  if (prev.isStreaming !== next.isStreaming) return false
  if (prev.message.id !== next.message.id) return false
  if (prev.message.role !== next.message.role) return false
  if (prev.message.parts.length !== next.message.parts.length) return false
  if (prev.renderFinalText !== next.renderFinalText) return false
  if (prev.script !== next.script) return false
  if (prev.scripts !== next.scripts) return false
  if (prev.assets !== next.assets) return false
  if (prev.generating !== next.generating) return false
  if (prev.videos !== next.videos) return false
  if (prev.onReferenceVideo !== next.onReferenceVideo) return false
  if (prev.isLatestAssistant !== next.isLatestAssistant) return false
  if (!next.isStreaming) return true
  return false
})
