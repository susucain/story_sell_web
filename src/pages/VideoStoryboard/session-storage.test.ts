import { describe, expect, it } from 'vitest'
import {
  getSessionStorageKey,
  resolveInitialSessionId,
} from './session-storage'

describe('video storyboard session storage', () => {
  it('isolates the stored session ID by authenticated user', () => {
    expect(getSessionStorageKey(12)).toBe('video_storyboard_session_id:12')
    expect(getSessionStorageKey(34)).toBe('video_storyboard_session_id:34')
  })

  it('keeps a cached session only when it belongs to the current user session list', () => {
    expect(resolveInitialSessionId({
      cachedSessionId: 'session-b',
      sessions: [{ sessionId: 'session-a' }, { sessionId: 'session-b' }],
      createSessionId: () => 'new-session',
    })).toBe('session-b')
  })

  it('falls back to the most recently returned user session when cache is stale', () => {
    expect(resolveInitialSessionId({
      cachedSessionId: 'test-nothink',
      sessions: [{ sessionId: 'latest-session' }, { sessionId: 'older-session' }],
      createSessionId: () => 'new-session',
    })).toBe('latest-session')
  })

  it('creates a session when the current user has no sessions', () => {
    expect(resolveInitialSessionId({
      cachedSessionId: null,
      sessions: [],
      createSessionId: () => 'new-session',
    })).toBe('new-session')
  })
})
