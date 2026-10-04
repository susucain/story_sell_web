import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import type { ProcessState } from './process-types'

export type AnyToolPart = Extract<
  UIMessage['parts'][number],
  { type: `tool-${string}` } | { type: 'dynamic-tool' }
>

/** 文本 part 的角色：过程旁白（工具调用前）或最终答复 */
export type AssistantTextRole = 'answer' | 'interstitial'

export interface AssistantTextPart {
  part: Extract<UIMessage['parts'][number], { type: 'text' }>
  role: AssistantTextRole
  /** 后端下发的 step 序号；本次改动前入库的历史消息没有该信息，为 null */
  stepIndex: number | null
}

export interface AssistantParts {
  mainToolParts: AnyToolPart[]
  subAgentSections: { taskPart: AnyToolPart; toolParts: AnyToolPart[] }[]
  textParts: AssistantTextPart[]
  reasoningParts: { type: string; text: string }[]
}

/** 后端为文本 part 打上的 step 前缀，形如 `s2-txt-0` */
const STEP_TEXT_ID = /^s(\d+)-txt-/

function stepIndexFromPartId(id: unknown): number | null {
  if (typeof id !== 'string') return null
  const matched = STEP_TEXT_ID.exec(id)
  return matched ? Number(matched[1]) : null
}

/** 汇总 `data-text-meta` 下发的 step 角色；后到的元数据覆盖先到的 */
function collectStepRoles(
  parts: UIMessage['parts'],
): Map<number, AssistantTextRole> {
  const roles = new Map<number, AssistantTextRole>()
  parts.forEach((part) => {
    const metaPart = part as {
      type?: string
      data?: { stepIndex?: unknown; interstitial?: unknown }
    }
    if (metaPart?.type !== 'data-text-meta') return
    const { stepIndex, interstitial } = metaPart.data ?? {}
    if (typeof stepIndex !== 'number') return
    roles.set(stepIndex, interstitial ? 'interstitial' : 'answer')
  })
  return roles
}

/**
 * 拆分 assistant 消息的 parts：
 * - mainToolParts：主 agent 的工具调用（按出现顺序）
 * - subAgentSections：子 agent 的工具调用分组（每个 task 工具调用对应一个子 agent section）
 * - textParts：全部文本输出及其角色（过程旁白 / 最终答复），按出现顺序
 * - reasoningParts：思考过程
 *
 * 文本角色以后端下发的 step 元数据为准：带 `s<step>-` 前缀的文本按所属
 * step 的角色渲染；角色未到达前先按最终答复渲染，到达后原地降级为旁白，
 * 不做删除或搬运，避免流式期间反复「出现又消失」。
 *
 * 子 agent 的工具调用通过 task 工具调用来识别：
 * - task 工具调用标志着子 agent 的开始
 * - task 之后的非 task 工具调用属于该子 agent
 * - 下一个 task 工具调用或主 agent 工具调用标志着子 agent 的结束
 */
export function splitAssistantParts(parts: UIMessage['parts']): AssistantParts {
  const mainToolParts: AnyToolPart[] = []
  const reasoningParts: { type: string; text: string }[] = []
  const subAgentSections: { taskPart: AnyToolPart; toolParts: AnyToolPart[] }[] = []

  let currentSubAgent: { taskPart: AnyToolPart; toolParts: AnyToolPart[] } | null =
    null

  parts.forEach((part) => {
    if (isToolUIPart(part as any)) {
      const toolPart = part as AnyToolPart
      const name = getToolName(toolPart as any)

      if (name === 'task') {
        if (currentSubAgent) {
          subAgentSections.push(currentSubAgent)
        }
        currentSubAgent = { taskPart: toolPart, toolParts: [] }
      } else if (currentSubAgent) {
        currentSubAgent.toolParts.push(toolPart)
      } else {
        mainToolParts.push(toolPart)
      }
    }

    if (part.type === 'reasoning' && 'text' in part) {
      reasoningParts.push({ type: 'reasoning', text: (part as any).text })
    }
  })

  if (currentSubAgent) {
    subAgentSections.push(currentSubAgent)
  }

  const hasStepMarkedText = parts.some(
    (part) =>
      part.type === 'text' && stepIndexFromPartId((part as { id?: unknown }).id) !== null,
  )

  if (hasStepMarkedText) {
    const stepRoles = collectStepRoles(parts)
    const textParts: AssistantTextPart[] = []
    parts.forEach((part) => {
      if (part.type !== 'text') return
      const stepIndex = stepIndexFromPartId((part as { id?: unknown }).id)
      if (stepIndex === null) return
      textParts.push({
        part: part as AssistantTextPart['part'],
        role: stepRoles.get(stepIndex) ?? 'answer',
        stepIndex,
      })
    })
    return { mainToolParts, subAgentSections, textParts, reasoningParts }
  }

  // 历史消息兼容：本次改动前入库的消息既没有 step 前缀也没有角色元数据，
  // 沿用旧的「最后一次主 agent 工具调用之后即最终文本」判定，保持渲染不变。
  const legacyTextParts: AssistantTextPart[] = []
  let inSubAgent = false
  let lastToolIdx = -1

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

    if (parts[idx - 1] && isToolUIPart(parts[idx - 1] as any)) {
      const prevName = getToolName(parts[idx - 1] as any)
      if (prevName === 'task') {
        inSubAgent = true
      }
    }

    if (parts[idx + 1] && isToolUIPart(parts[idx + 1] as any)) {
      const nextName = getToolName(parts[idx + 1] as any)
      if (nextName !== 'task') {
        inSubAgent = false
      }
    }

    if (!inSubAgent && (lastToolIdx === -1 || idx > lastToolIdx)) {
      legacyTextParts.push({
        part: part as AssistantTextPart['part'],
        role: 'answer',
        stepIndex: null,
      })
    }
  })

  return {
    mainToolParts,
    subAgentSections,
    textParts: legacyTextParts,
    reasoningParts,
  }
}

/** 过程旁白及其归属阶段 */
export interface PhaseRationale {
  /** 归属的阶段 id；无法定位时为 null，由渲染层兜底 */
  phaseId: string | null
  text: string
}

/**
 * 把过程旁白按「该段文本出现时正在运行的阶段」归位。
 *
 * 过程状态快照（`data-process-state`）与文本 part 在流里按时间顺序交错写入，
 * 因此可以用「这段文本之前最近一次快照中处于 running 的阶段」作为归属依据；
 * 若此前还没有任何快照，则归为 null，由渲染层兜底放到最后一个阶段。
 */
export function collectPhaseRationales(
  parts: UIMessage['parts'],
  textParts: AssistantTextPart[],
): PhaseRationale[] {
  const interstitialParts = new Set(
    textParts
      .filter((item) => item.role === 'interstitial')
      .map((item) => item.part),
  )
  if (interstitialParts.size === 0) return []

  const rationales: PhaseRationale[] = []
  let runningPhaseId: string | null = null

  parts.forEach((part) => {
    const statePart = part as { type?: string; data?: ProcessState }
    if (statePart.type === 'data-process-state') {
      const running = statePart.data?.phases?.find(
        (phase) => phase.status === 'running',
      )
      if (running) runningPhaseId = running.id
      return
    }
    if (part.type !== 'text' || !interstitialParts.has(part)) return
    const text = part.text?.trim()
    if (text) rationales.push({ phaseId: runningPhaseId, text })
  })

  return rationales
}
