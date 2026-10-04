import { describe, expect, it } from 'vitest'
import type { RunStreamEvent } from './api'
import { applyRunEvent, buildRecoveredMessage, createRunRecoveryState } from './run-recovery'

function event(type: string, data: unknown, id = '1-0'): RunStreamEvent {
  return { id, type, data }
}

describe('run recovery', () => {
  it('accumulates text deltas by part id and preserves first-seen order', () => {
    const state = createRunRecoveryState()
    applyRunEvent(state, event('text-delta', { id: 's0-txt-0', delta: '你' }))
    applyRunEvent(state, event('text-delta', { id: 's0-txt-0', delta: '好' }))
    applyRunEvent(state, event('text-delta', { id: 's1-txt-0', delta: '正文' }))

    expect(state.textOrder).toEqual(['s0-txt-0', 's1-txt-0'])
    expect(state.textById.get('s0-txt-0')).toBe('你好')
  })

  it('keeps only the latest panel snapshot', () => {
    const state = createRunRecoveryState()
    applyRunEvent(state, event('panel', { status: 'running', phases: [{ id: 'a' }] }))
    applyRunEvent(state, event('panel', { status: 'completed', phases: [{ id: 'b' }] }))

    expect(state.panel).toEqual({ status: 'completed', phases: [{ id: 'b' }] })
  })

  it('records step roles and result script id', () => {
    const state = createRunRecoveryState()
    applyRunEvent(state, event('text-meta', { stepIndex: 0, interstitial: true }))
    applyRunEvent(state, event('text-meta', { stepIndex: 1, interstitial: false }))

    expect(state.stepRoles.get(0)).toBe(true)
    expect(state.stepRoles.get(1)).toBe(false)

    applyRunEvent(state, event('result', { scriptId: 80 }))
    const message = buildRecoveredMessage('run-1', state)
    expect(message.metadata).toEqual({ scriptId: 80 })
  })

  it('builds a message that mirrors the streaming part contract', () => {
    const state = createRunRecoveryState()
    applyRunEvent(state, event('panel', { status: 'running', phases: [] }))
    applyRunEvent(state, event('text-delta', { id: 's1-txt-0', delta: '最终答复' }))
    applyRunEvent(state, event('text-meta', { stepIndex: 1, interstitial: false }))

    const message = buildRecoveredMessage('run-7', state)

    expect(message.id).toBe('run-recovery-run-7')
    expect(message.role).toBe('assistant')
    expect(message.parts).toEqual([
      { type: 'data-process-state', id: 'recovery-panel', data: { status: 'running', phases: [] } },
      { type: 'text', id: 's1-txt-0', text: '最终答复' },
      {
        type: 'data-text-meta',
        id: 'recovery-meta-1',
        data: { stepIndex: 1, interstitial: false },
      },
    ])
  })
})
