import { render, screen } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { AgentMessage } from '.'

const completedProcess = {
  status: 'completed',
  phases: [
    {
      id: 'generate-script',
      title: '生成分镜脚本',
      description: '提炼卖点并生成分镜脚本',
      status: 'completed',
    },
  ],
}

describe('AgentMessage', () => {
  it('keeps interstitial text visible after streaming completes', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'data-process-state', data: completedProcess },
        { type: 'text', id: 's0-txt-0', text: '正在整理套餐卖点' },
        { type: 'data-text-meta', data: { stepIndex: 0, interstitial: true } },
        { type: 'text', id: 's1-txt-0', text: '脚本已生成' },
        { type: 'data-text-meta', data: { stepIndex: 1, interstitial: false } },
      ],
    } as unknown as UIMessage

    render(<AgentMessage message={message} />)

    expect(screen.getByText('正在整理套餐卖点')).toBeTruthy()
    expect(screen.getByText('脚本已生成')).toBeTruthy()
  })
})
