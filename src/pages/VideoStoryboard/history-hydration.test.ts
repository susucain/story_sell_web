import { describe, expect, it } from 'vitest'
import { shouldApplyHistoryResult } from './history-hydration'

describe('history hydration guard', () => {
  it('accepts history for the current idle session', () => {
    expect(shouldApplyHistoryResult({
      requestSessionId: 'session-1',
      currentSessionId: 'session-1',
      chatStarted: false,
      disposed: false,
    })).toBe(true)
  })

  it('rejects history after chat streaming has started', () => {
    expect(shouldApplyHistoryResult({
      requestSessionId: 'session-1',
      currentSessionId: 'session-1',
      chatStarted: true,
      disposed: false,
    })).toBe(false)
  })

  it('rejects history for a switched session or disposed component', () => {
    expect(shouldApplyHistoryResult({
      requestSessionId: 'session-1',
      currentSessionId: 'session-2',
      chatStarted: false,
      disposed: false,
    })).toBe(false)
    expect(shouldApplyHistoryResult({
      requestSessionId: 'session-1',
      currentSessionId: 'session-1',
      chatStarted: false,
      disposed: true,
    })).toBe(false)
  })
})
