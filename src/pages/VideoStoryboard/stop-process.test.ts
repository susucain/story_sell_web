import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { removeStoppedAssistantTurn } from './stop-process'

const userMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: '生成脚本' }] } as UIMessage

describe('removeStoppedAssistantTurn', () => {
  it('removes an unfinished assistant process turn', () => {
    const assistant = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'data-process-state', data: { status: 'running', phases: [] } },
        { type: 'tool-generate_script', state: 'input-available', input: {} },
      ],
    } as UIMessage

    expect(removeStoppedAssistantTurn([userMessage, assistant])).toEqual([userMessage])
  })

  it('keeps visible text but removes its process panel', () => {
    const assistant = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'data-process-state', data: { status: 'running', phases: [] } },
        { type: 'text', text: '已生成部分内容' },
      ],
    } as UIMessage

    expect(removeStoppedAssistantTurn([userMessage, assistant])[1].parts).toEqual([
      { type: 'text', text: '已生成部分内容' },
    ])
  })

  it('does not change completed messages without a process state', () => {
    const assistant = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: '完成' }],
    } as UIMessage

    expect(removeStoppedAssistantTurn([userMessage, assistant])).toEqual([userMessage, assistant])
  })
})
