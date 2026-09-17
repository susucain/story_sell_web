import { describe, expect, it } from 'vitest'
import {
  createRetryRequest,
  discardFailedEphemeralMessages,
  getVideoAgentErrorAction,
  isRetryForSession,
} from './retry'

describe('video storyboard retry', () => {
  const request = {
    sessionId: 'session-1',
    text: '生成分镜',
    files: [],
    body: { session_id: 'session-1' },
  }

  it('marks only the cached session retry request as retryable', () => {
    expect(isRetryForSession(request, 'session-1')).toBe(true)
    expect(isRetryForSession(request, 'session-2')).toBe(false)
    expect(createRetryRequest(request).body).toEqual({
      session_id: 'session-1',
      retry: true,
    })
  })

  it('removes the failed user turn and partial assistant before retrying', () => {
    const messages = [
      { id: 'old-user', role: 'user', parts: [{ type: 'text', text: '旧需求' }] },
      { id: 'old-assistant', role: 'assistant', parts: [{ type: 'text', text: '旧回答' }] },
      { id: 'failed-user', role: 'user', parts: [{ type: 'text', text: '生成分镜' }] },
      { id: 'partial-assistant', role: 'assistant', parts: [{ type: 'text', text: '部分回答' }] },
    ]

    expect(discardFailedEphemeralMessages(messages)).toEqual(messages.slice(0, 2))
  })

  it('offers retry only for explicitly retryable timeout codes', () => {
    expect(getVideoAgentErrorAction(new Error(JSON.stringify({
      code: 'MODEL_TIMEOUT',
      retryable: true,
      message: '创作请求超时，请重试',
    })))).toEqual({
      type: 'retry',
      message: '创作请求超时，请重试',
    })

    expect(getVideoAgentErrorAction(new Error(JSON.stringify({
      code: 'TOOL_TIMEOUT',
      retryable: false,
      message: '操作状态未知，请刷新查看结果',
    })))).toBeNull()
  })

  it('offers refresh instead of retry when a mutation status is unknown', () => {
    expect(getVideoAgentErrorAction(new Error(JSON.stringify({
      code: 'OPERATION_STATUS_UNKNOWN',
      retryable: false,
      message: '操作状态未知，请刷新查看结果',
    })))).toEqual({
      type: 'refresh',
      message: '操作状态未知，请刷新查看结果',
    })
  })
})
