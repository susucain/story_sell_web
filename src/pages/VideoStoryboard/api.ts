import type { UIMessage } from 'ai'
import type { AssetItem, ScriptVersion, SessionPage, VideoTaskItem } from './types'
import { apiFetch } from '../../lib/api-fetch'

const BASE = '/video'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function fetchSessions(
  page = 1,
  pageSize = 7,
  keyword?: string,
  signal?: AbortSignal,
): Promise<SessionPage> {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('page_size', String(pageSize))
  if (keyword) params.set('keyword', keyword)
  return fetchJson<SessionPage>(`${BASE}/sessions?${params.toString()}`, { signal })
}

export function fetchHistory(sessionId: string): Promise<UIMessage[]> {
  return fetchJson<UIMessage[]>(`${BASE}/history/${sessionId}`)
}

export function fetchAssets(sessionId: string): Promise<AssetItem[]> {
  return fetchJson<AssetItem[]>(`${BASE}/assets/${sessionId}`)
}

export interface CreateAssetBody {
  session_id: string
  asset_type: 'image' | 'video' | 'url'
  asset_purpose?: 'all' | 'analysis' | 'reference'
  name: string
  url: string
  thumbnail_url?: string
  duration_sec?: number
  content_category?: 'portrait' | 'product' | 'food' | 'store' | 'environment' | 'other'
}

export function createAsset(body: CreateAssetBody): Promise<AssetItem> {
  return fetchJson<AssetItem>(`${BASE}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteAsset(assetId: number): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>(`${BASE}/assets/${assetId}`, {
    method: 'DELETE',
  })
}

export function updateAssetPurpose(
  assetId: number,
  assetPurpose: 'all' | 'analysis' | 'reference',
): Promise<AssetItem> {
  return fetchJson<AssetItem>(`${BASE}/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_purpose: assetPurpose }),
  })
}

export function fetchScripts(sessionId: string): Promise<ScriptVersion[]> {
  return fetchJson<ScriptVersion[]>(`${BASE}/scripts/${sessionId}`)
}

export function fetchScriptDetail(scriptId: number): Promise<ScriptVersion> {
  return fetchJson<ScriptVersion>(`${BASE}/scripts/${scriptId}/detail`)
}

export interface GenerateVideoBody {
  script_id: number
  session_id: string
  user_prompt?: string
  assets?: Array<{
    type: 'image' | 'video'
    url: string
    name?: string
  }>
}

export function generateVideo(body: GenerateVideoBody): Promise<VideoTaskItem> {
  return fetchJson<VideoTaskItem>(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function fetchVideoTask(taskId: string): Promise<VideoTaskItem> {
  return fetchJson<VideoTaskItem>(`${BASE}/generate/${taskId}`)
}

export function fetchVideoTasksBySession(sessionId: string): Promise<VideoTaskItem[]> {
  return fetchJson<VideoTaskItem[]>(`${BASE}/generate/list/${sessionId}`)
}

export function cancelVideoTask(taskId: string): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>(`${BASE}/generate/${taskId}`, {
    method: 'DELETE',
  })
}

const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled', 'expired']

export function subscribeTaskStatus(
  taskId: string,
  onUpdate: (task: Partial<VideoTaskItem>) => void,
): () => void {
  const controller = new AbortController()
  let closed = false
  const close = () => {
    if (!closed) {
      closed = true
      controller.abort()
    }
  }

  void (async () => {
    try {
      const response = await apiFetch(`${BASE}/generate/${taskId}/stream`, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error('任务状态订阅失败')
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += value
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          const dataLine = event.split('\n').find((line) => line.startsWith('data:'))
          if (!dataLine) continue
          const task = JSON.parse(dataLine.slice(5).trim()) as Partial<VideoTaskItem>
          onUpdate(task)
          if (task.status && TERMINAL_STATUSES.includes(task.status)) {
            close()
            return
          }
        }
      }
    } catch {
      if (closed) return
      close()
      try {
        onUpdate(await fetchVideoTask(taskId))
      } catch {
        // Ignore unavailable fallback state.
      }
    }
  })()

  return close
}
