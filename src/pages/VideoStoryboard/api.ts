import type { UIMessage } from 'ai'
import type { AssetItem, ScriptVersion, SessionSummary, VideoTaskItem } from './types'

const BASE = '/video'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function fetchSessions(userId?: number): Promise<SessionSummary[]> {
  const qs = userId ? `?user_id=${userId}` : ''
  return fetchJson<SessionSummary[]>(`${BASE}/sessions${qs}`)
}

export function fetchHistory(sessionId: string): Promise<UIMessage[]> {
  return fetchJson<UIMessage[]>(`${BASE}/history/${sessionId}`)
}

export function fetchAssets(sessionId: string): Promise<AssetItem[]> {
  return fetchJson<AssetItem[]>(`${BASE}/assets/${sessionId}`)
}

export interface CreateAssetBody {
  session_id: string
  user_id?: number
  asset_type: 'image' | 'video' | 'url'
  asset_purpose: 'analysis' | 'reference'
  name: string
  url: string
  thumbnail_url?: string
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

export function fetchScripts(sessionId: string): Promise<ScriptVersion[]> {
  return fetchJson<ScriptVersion[]>(`${BASE}/scripts/${sessionId}`)
}

export function fetchScriptDetail(scriptId: number): Promise<ScriptVersion> {
  return fetchJson<ScriptVersion>(`${BASE}/scripts/${scriptId}/detail`)
}

export function generateVideo(body: { script_id: number; callback_url?: string }): Promise<VideoTaskItem> {
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
  const url = `${BASE}/generate/${taskId}/stream`
  const eventSource = new EventSource(url)
  let closed = false
  const close = () => {
    if (!closed) {
      closed = true
      eventSource.close()
    }
  }
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onUpdate(data)
      // 收到终态后主动关闭 SSE 连接
      if (TERMINAL_STATUSES.includes(data.status)) {
        close()
      }
    } catch {
      // ignore malformed
    }
  }
  eventSource.onerror = async () => {
    close()
    // 网络断开降级：单次查询当前状态
    try {
      const task = await fetchVideoTask(taskId)
      onUpdate(task)
    } catch {
      // ignore
    }
  }
  return close
}
