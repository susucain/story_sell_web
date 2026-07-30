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
} from '@ant-design/icons'
import { Image } from 'antd'
import { StreamdownText } from '../StreamdownText'
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

export interface AgentMessageProps {
  message: UIMessage
  isStreaming?: boolean
  /** 非流式状态下，对最终文本调用此函数；返回非 null 则用自定义渲染替代 StreamdownText */
  renderFinalText?: (text: string) => React.ReactNode | null
}

export const AgentMessage = memo(function AgentMessage({ message, isStreaming = false, renderFinalText }: AgentMessageProps) {
  // user 角色
  if (message.role !== 'assistant') {
    return (
      <div className={`storyboard-bubble storyboard-bubble--${message.role}`}>
        <div className="storyboard-role">你</div>
        <div className="storyboard-content">
          {message.parts.map((part, i) =>
            part.type === 'text' ? (
              <div key={i} className="storyboard-text">{part.text}</div>
            ) : part.type === 'file' ? (
              <div key={i} className="storyboard-image">
                <Image src={part.url} alt="reference" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 6 }} preview />
              </div>
            ) : null,
          )}
        </div>
      </div>
    )
  }

  // assistant 角色
  const { mainToolParts, subAgentSections, finalTextParts } = splitAssistantParts(message.parts)
  const lastTextIdx = finalTextParts.length - 1

  return (
    <div className="storyboard-bubble storyboard-bubble--assistant">
      <div className="storyboard-role">助手</div>
      <div className="storyboard-content">
        {/* 主 agent 工具调用（可折叠） */}
        <CollapsibleToolSteps total={mainToolParts.length} label="工具调用">
          <div className="agent-steps">
            {mainToolParts.map((part, i) => (
              <ToolStep key={part.toolCallId ?? i} part={part} isStreaming={isStreaming} />
            ))}
          </div>
        </CollapsibleToolSteps>
        {/* 子 agent 任务分组（可折叠） */}
        {subAgentSections.map((section, sectionIdx) => {
          const subTotal = 1 + section.toolParts.length
          const subLabel = typeof section.taskPart === 'object' && 'input' in section.taskPart
            ? (() => {
                const input = (section.taskPart as any).input
                const sub = typeof input?.subagent_type === 'string' ? input.subagent_type : ''
                const desc = typeof input?.description === 'string' ? truncate(input.description, 40) : ''
                return sub ? `${sub}${desc ? ' · ' + desc : ''}` : undefined
              })()
            : undefined
          return (
            <CollapsibleToolSteps key={sectionIdx} total={subTotal} label={subLabel}>
              <div className="sub-agent-section">
                <ToolStep part={section.taskPart} isStreaming={isStreaming} />
                {section.toolParts.length > 0 && (
                  <div className="sub-agent-steps">
                    {section.toolParts.map((part, i) => (
                      <ToolStep key={part.toolCallId ?? i} part={part} isStreaming={isStreaming} />
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleToolSteps>
          )
        })}
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
              <StreamdownText isStreaming={isStreaming && i === lastTextIdx}>
                {part.text}
              </StreamdownText>
            </div>
          )
        })}
      </div>
    </div>
  )
}, (prev, next) => {
  if (prev.isStreaming !== next.isStreaming) return false
  if (prev.message.id !== next.message.id) return false
  if (prev.message.role !== next.message.role) return false
  if (prev.message.parts.length !== next.message.parts.length) return false
  if (prev.renderFinalText !== next.renderFinalText) return false
  if (!next.isStreaming) return true
  return false
})
