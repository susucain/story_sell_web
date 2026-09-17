type SessionSummary = {
  sessionId: string
}

const STORAGE_KEY_PREFIX = 'video_storyboard_session_id'

export function getSessionStorageKey(userId: number): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`
}

export function getOrCreateUserSessionId(
  userId: number,
  createSessionId: () => string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): string {
  const storageKey = getSessionStorageKey(userId)
  const cachedSessionId = storage.getItem(storageKey)
  if (cachedSessionId) return cachedSessionId

  const sessionId = createSessionId()
  storage.setItem(storageKey, sessionId)
  return sessionId
}

export function resolveInitialSessionId(options: {
  cachedSessionId: string | null
  sessions: SessionSummary[]
  createSessionId: () => string
}): string {
  const { cachedSessionId, sessions, createSessionId } = options
  if (cachedSessionId && sessions.some((session) => session.sessionId === cachedSessionId)) {
    return cachedSessionId
  }
  return sessions[0]?.sessionId ?? createSessionId()
}

export function isSessionResourceLoadReady(sessionValidated: boolean): boolean {
  return sessionValidated
}
