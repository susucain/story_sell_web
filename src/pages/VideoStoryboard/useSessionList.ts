import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSessions } from './api'
import type { SessionSummary } from './types'
import { isAbortError, reportError } from '../../lib/report-error'

const SEARCH_DEBOUNCE_MS = 300

export function useSessionList(
  pageSize: number,
  onSessionsLoaded?: (sessions: SessionSummary[]) => void,
  onSessionsLoadFailed?: () => void,
) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [searchQuery, setSearchQueryValue] = useState('')
  const [keyword, setKeyword] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const pageRef = useRef(1)
  const sessionCacheRef = useRef(new Map<string, SessionSummary>())
  const requestRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)

  const loadPage = useCallback(async (page: number, append: boolean) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    const requestId = ++requestIdRef.current
    requestRef.current = controller
    setLoading(true)
    setError(false)

    try {
      const data = await fetchSessions(page, pageSize, keyword, controller.signal)
      if (requestId !== requestIdRef.current) return

      data.items.forEach((session) => {
        sessionCacheRef.current.set(session.sessionId, session)
      })
      setSessions((previous) => {
        if (!append) return data.items
        const seen = new Set(previous.map((session) => session.sessionId))
        return [...previous, ...data.items.filter((session) => !seen.has(session.sessionId))]
      })
      if (!append && !keyword) onSessionsLoaded?.(data.items)
      pageRef.current = data.page
      setHasMore(data.hasMore)
    } catch (requestError) {
      if (isAbortError(requestError)) return
      if (requestId === requestIdRef.current) {
        setError(true)
        reportError('video.sessions.load', requestError)
        onSessionsLoadFailed?.()
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [keyword, onSessionsLoadFailed, onSessionsLoaded, pageSize])

  const refresh = useCallback(() => loadPage(1, false), [loadPage])

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return
    void loadPage(pageRef.current + 1, true)
  }, [hasMore, loadPage, loading])

  const setSearchQuery = useCallback((value: string) => {
    setSearchQueryValue(value)
    if (!value.trim()) setKeyword('')
  }, [])

  const getCachedSession = useCallback(
    (sessionId: string) => sessionCacheRef.current.get(sessionId),
    [],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => {
      window.clearTimeout(timer)
      requestRef.current?.abort()
    }
  }, [refresh])

  useEffect(() => {
    if (isComposing) return
    const normalized = searchQuery.trim()
    if (normalized === keyword) return

    if (!normalized) return

    const timer = window.setTimeout(() => setKeyword(normalized), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [isComposing, keyword, searchQuery])

  return {
    sessions,
    hasMore,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    setIsComposing,
    getCachedSession,
    refresh,
    loadMore,
  }
}
