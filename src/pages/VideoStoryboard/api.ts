import type { UIMessage } from 'ai'
import type {
  AssetItem,
  ScriptVersion,
  SessionPage,
  VideoContinuityMode,
  VideoGenerationPlan,
  VideoTaskItem,
} from './types'
import { apiFetch } from '../../lib/api-fetch'
import { reportError } from '../../lib/report-error'

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

export function fetchHistory(sessionId: string, signal?: AbortSignal): Promise<UIMessage[]> {
  return fetchJson<UIMessage[]>(`${BASE}/history/${sessionId}`, { signal })
}

/**
 * 中止该会话在途的 Agent 运行（单会话单链路）。
 * 后端按 sessionId 定位 run 并 abort，流式响应会自然结束并落库已完成内容。
 */
export function cancelChatRun(sessionId: string): Promise<{ cancelled: boolean }> {
  return fetchJson<{ cancelled: boolean }>(`${BASE}/chat/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export interface ActiveRunInfo {
  runId: string
  status: string
  startedAt: string
}

/** 查询会话当前进行中的 run；无在途运行时 run 为 null */
export function fetchActiveRun(
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ run: ActiveRunInfo | null }> {
  return fetchJson<{ run: ActiveRunInfo | null }>(
    `${BASE}/sessions/${sessionId}/active-run`,
    { signal },
  )
}

export interface RunStreamEvent {
  /** 事件游标（Redis Stream 条目 ID），用作重放 `after` */
  id: string
  type: string
  data: unknown
}

function parseSseFrame(frame: string): RunStreamEvent | null {
  let id: string | undefined
  let data: string | undefined
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('data:')) data = line.slice(5).trim()
  }
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as RunStreamEvent
    if (id) parsed.id = id
    return parsed
  } catch {
    return null
  }
}

/**
 * 订阅 run 的事件流：先重放 `after` 之后的事件，再尾随推送。
 * 断线自动重连（指数退避），并携带已收到的游标以无缝续上。
 */
export function subscribeRunEvents(
  runId: string,
  after: string | undefined,
  handlers: {
    onEvent: (event: RunStreamEvent) => void
    onEnd?: () => void
    onError?: (error: unknown) => void
  },
): () => void {
  const controller = new AbortController()
  let closed = false
  let cursor = after
  let attempt = 0

  const close = () => {
    if (!closed) {
      closed = true
      controller.abort()
    }
  }

  void (async () => {
    while (!closed) {
      try {
        const query = cursor ? `?after=${encodeURIComponent(cursor)}` : ''
        const response = await apiFetch(`${BASE}/runs/${runId}/events${query}`, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error('运行事件订阅失败')
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        while (!closed) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += value
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const event = parseSseFrame(frame)
            if (!event) continue
            attempt = 0
            cursor = event.id
            handlers.onEvent(event)
            if (event.type === 'done') {
              close()
              handlers.onEnd?.()
              return
            }
          }
        }
      } catch (error) {
        if (closed) return
        handlers.onError?.(error)
      }
      // 未收到 done 就断开（网络抖动 / 代理超时）：退避后带游标重连
      if (closed) return
      attempt += 1
      if (attempt > 5) {
        handlers.onEnd?.()
        return
      }
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 10000))
      })
    }
  })()

  return close
}

export function fetchAssets(sessionId: string, signal?: AbortSignal): Promise<AssetItem[]> {
  return fetchJson<AssetItem[]>(`${BASE}/assets/${sessionId}`, { signal })
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

export function fetchScripts(sessionId: string, signal?: AbortSignal): Promise<ScriptVersion[]> {
  return fetchJson<ScriptVersion[]>(`${BASE}/scripts/${sessionId}`, { signal })
}

export function fetchScriptDetail(scriptId: number): Promise<ScriptVersion> {
  return fetchJson<ScriptVersion>(`${BASE}/scripts/${scriptId}/detail`)
}

export interface GenerateVideoBody {
  script_id: number
  session_id: string
  user_prompt?: string
  mode?: 'single' | 'segmented'
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

/** 长脚本分段生成：创建分段计划并提交第 1 段 */
export function createSegmentedVideo(
  body: Omit<GenerateVideoBody, 'mode'>,
): Promise<VideoGenerationPlan> {
  return fetchJson<VideoGenerationPlan>(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, mode: 'segmented' }),
  })
}

export function fetchGenerationPlan(planId: number): Promise<VideoGenerationPlan> {
  return fetchJson<VideoGenerationPlan>(`${BASE}/generate/plan/${planId}`)
}

/** 用户确认上一段后生成下一段，衔接方式由用户选择 */
export function startNextSegment(
  planId: number,
  continuityMode: VideoContinuityMode,
): Promise<VideoGenerationPlan> {
  return fetchJson<VideoGenerationPlan>(`${BASE}/generate/plan/${planId}/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ continuity_mode: continuityMode }),
  })
}

/** 重抽指定段；该段之后的已生成段会作废并需要重新生成 */
export function regenerateSegment(
  planId: number,
  segmentIndex: number,
  continuityMode: VideoContinuityMode,
): Promise<VideoGenerationPlan> {
  return fetchJson<VideoGenerationPlan>(
    `${BASE}/generate/plan/${planId}/segments/${segmentIndex}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ continuity_mode: continuityMode }),
    },
  )
}

export function cancelGenerationPlan(planId: number): Promise<VideoGenerationPlan> {
  return fetchJson<VideoGenerationPlan>(`${BASE}/generate/plan/${planId}/cancel`, {
    method: 'POST',
  })
}

export function fetchVideoTask(taskId: string): Promise<VideoTaskItem> {
  return fetchJson<VideoTaskItem>(`${BASE}/generate/${taskId}`)
}

export function fetchVideoTasksBySession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<VideoTaskItem[]> {
  return fetchJson<VideoTaskItem[]>(`${BASE}/generate/list/${sessionId}`, { signal })
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
    } catch (error) {
      if (closed) return
      reportError(`video.task-stream.${taskId}`, error)
      close()
      try {
        onUpdate(await fetchVideoTask(taskId))
      } catch (fallbackError) {
        reportError(`video.task-fallback.${taskId}`, fallbackError)
      }
    }
  })()

  return close
}
