import type { UIMessage } from 'ai'
import type { ProcessState } from '../../components/AgentMessage/process-types'
import type { RunStreamEvent } from './api'

/** 事件重放期间的累积状态：正文按 part id 合并，面板只保留最新全量快照 */
export interface RunRecoveryState {
  textOrder: string[]
  textById: Map<string, string>
  /** step 序号 → 是否为过程旁白（interstitial） */
  stepRoles: Map<number, boolean>
  panel?: ProcessState
  scriptId?: number
}

export function createRunRecoveryState(): RunRecoveryState {
  return { textOrder: [], textById: new Map(), stepRoles: new Map() }
}

/** 后端为文本 part 打上的 step 前缀，形如 `s2-txt-0` */
const STEP_TEXT_ID = /^s(\d+)-txt-/

function stepIndexFromPartId(id: string): number | null {
  const matched = STEP_TEXT_ID.exec(id)
  return matched ? Number(matched[1]) : null
}

/** 把一条 run 事件叠加到累积状态上（面板为全量快照，直接覆盖） */
export function applyRunEvent(state: RunRecoveryState, event: RunStreamEvent): void {
  switch (event.type) {
    case 'panel': {
      if (event.data) state.panel = event.data as ProcessState
      return
    }
    case 'text-delta': {
      const { id, delta } = (event.data ?? {}) as { id?: unknown; delta?: unknown }
      if (typeof id === 'string' && typeof delta === 'string' && delta) {
        if (!state.textById.has(id)) state.textOrder.push(id)
        state.textById.set(id, (state.textById.get(id) ?? '') + delta)
      }
      return
    }
    case 'text-meta': {
      const { stepIndex, interstitial } = (event.data ?? {}) as {
        stepIndex?: unknown
        interstitial?: unknown
      }
      if (typeof stepIndex === 'number') {
        state.stepRoles.set(stepIndex, Boolean(interstitial))
      }
      return
    }
    case 'result': {
      const { scriptId } = (event.data ?? {}) as { scriptId?: unknown }
      if (typeof scriptId === 'number') state.scriptId = scriptId
      return
    }
    default:
      return
  }
}

/**
 * 把累积状态合成为一条可交给 AgentMessage 渲染的 assistant 消息。
 * part 形状与流式链路保持一致：`data-process-state`（面板全量）、带
 * `s<step>-txt-` 前缀的文本 part、`data-text-meta`（文本角色）、metadata.scriptId。
 */
export function buildRecoveredMessage(runId: string, state: RunRecoveryState): UIMessage {
  const parts: unknown[] = []
  if (state.panel) {
    parts.push({ type: 'data-process-state', id: 'recovery-panel', data: state.panel })
  }
  for (const id of state.textOrder) {
    parts.push({ type: 'text', id, text: state.textById.get(id) ?? '' })
    const stepIndex = stepIndexFromPartId(id)
    if (stepIndex !== null && state.stepRoles.has(stepIndex)) {
      parts.push({
        type: 'data-text-meta',
        id: `recovery-meta-${stepIndex}`,
        data: { stepIndex, interstitial: state.stepRoles.get(stepIndex) },
      })
    }
  }
  const metadata: { scriptId?: number } = {}
  if (typeof state.scriptId === 'number') metadata.scriptId = state.scriptId
  return {
    id: `run-recovery-${runId}`,
    role: 'assistant',
    parts,
    metadata,
  } as unknown as UIMessage
}
