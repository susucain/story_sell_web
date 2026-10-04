import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage, type ChatTransport, getToolName, isToolUIPart } from 'ai'
import {
  SendOutlined,
  CloseOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  FileTextOutlined,
  CloseCircleFilled,
  MenuOutlined,
} from '@ant-design/icons'
import {
  Button,
  Input,
  Image,
  message as antdMessage,
  Modal,
  Radio,
  Tabs,
  Tooltip,
  Drawer,
} from 'antd'
import { AgentMessage } from '../../components/AgentMessage'
import { RightPanel } from './RightPanel'
import { SessionPanel } from './SessionPanel'
import type { SessionSummary, AssetItem, ScriptVersion, VideoTaskItem, ParsedStoryboard, VideoContinuityMode } from './types'
import { toParsedStoryboard, shouldUseSegmentedGeneration } from './types'
import {
  fetchHistory,
  fetchAssets,
  createAsset,
  deleteAsset,
  updateAssetPurpose,
  fetchScripts,
  generateVideo,
  fetchVideoTasksBySession,
  subscribeTaskStatus,
  cancelChatRun,
  fetchActiveRun,
  subscribeRunEvents,
} from './api'
import {
  applyRunEvent,
  buildRecoveredMessage,
  createRunRecoveryState,
  type RunRecoveryState,
} from './run-recovery'
import { useGenerationPlan } from './useGenerationPlan'
import { SegmentPlanPanel } from './SegmentPlanPanel'
import { useSessionList } from './useSessionList'
import { createSessionId } from './session-id'
import {
  getOrCreateUserSessionId,
  getSessionStorageKey,
  isSessionResourceLoadReady,
  resolveInitialSessionId,
} from './session-storage'
import { apiFetch } from '../../lib/api-fetch'
import { isAbortError, reportError } from '../../lib/report-error'
import { useAuth } from '../../auth/auth-context'
import { useNavigate } from 'react-router-dom'
import {
  createRetryRequest,
  discardFailedEphemeralMessages,
  getVideoAgentErrorAction,
  isRetryForSession,
  type VideoStoryboardRetryRequest,
} from './retry'
import { removeStoppedAssistantTurn } from './stop-process'
import { shouldApplyHistoryResult } from './history-hydration'
import { useWorkspaceMode } from './responsive-layout'
import './style.css'

const SESSION_PAGE_SIZE = 20
const CHAT_UPDATE_THROTTLE_MS = 80
/** 恢复视图的合成节流：每个事件都重建整条消息代价高，按帧合批 */
const RECOVERY_UPDATE_THROTTLE_MS = 80
/** 视频模型单次生成上限（秒），超过即走分段生成 */
const MAX_SEGMENT_DURATION_SEC = 15

// 自定义 transport：只发送最新消息，历史由后端从数据库加载
class LatestMessageOnlyTransport extends DefaultChatTransport<UIMessage> {
  constructor() {
    super({
      api: '/video/chat',
      credentials: 'include',
      fetch: apiFetch,
    })
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0],
  ): Promise<ReadableStream<import('ai').UIMessageChunk>> {
    const { messages, ...rest } = options
    const latestMessage = messages[messages.length - 1]
    return super.sendMessages({
      ...rest,
      messages: latestMessage ? [latestMessage] : [],
    })
  }
}

interface UploadedImage {
  id: string
  url: string
  mediaType: string
  name: string
  assetPurpose: 'all' | 'analysis' | 'reference'
  durationSec?: number
  uploading?: boolean
}

function readVideoDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const timeout = window.setTimeout(() => finish(undefined), 5000)

    function finish(duration: number | undefined) {
      window.clearTimeout(timeout)
      video.removeAttribute('src')
      video.load()
      resolve(duration)
    }

    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 1000) / 1000
        : undefined
      finish(duration)
    }
    video.onerror = () => finish(undefined)
    video.src = url
  })
}

function detectMediaTypeFromUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0]
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  return 'image/jpeg'
}

async function detectMediaTypeFromNetwork(url: string): Promise<string> {
  try {
    const resp = await fetch(url, { method: 'HEAD' })
    const ct = resp.headers.get('content-type')
    if (ct && (ct.startsWith('image/') || ct.startsWith('video/'))) return ct
  } catch {
    // fallback
  }
  return detectMediaTypeFromUrl(url)
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

let uploadSequence = 0

/** 同一批选择/粘贴的文件会在同一个 tick 内创建，用时间戳会撞 id。 */
function createUploadId(): string {
  uploadSequence += 1
  return `${Date.now()}-${uploadSequence}`
}

/** 后端按文件名取扩展名拼 OSS key，粘贴来的图片常常没有文件名，这里按 MIME 兜底。 */
function toUploadFileName(file: File): string {
  if (file.name.includes('.')) return file.name
  const ext = MIME_EXTENSIONS[file.type]
  if (ext) return `${file.name || '粘贴素材'}-${Date.now()}.${ext}`
  return file.name || `素材-${Date.now()}`
}

function isUploadableFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (date.toDateString() === now.toDateString()) return `${hours} 小时前`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  if (diff < 7 * 86400000) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
  }
  return `${date.getMonth() + 1}-${date.getDate()}`
}

/** 会话状态 → 副标题文案 */
function sessionStatusText(status: string): string {
  switch (status) {
    case 'script_generated':
      return '脚本已生成'
    case 'video_generating':
      return '正在合成视频'
    case 'video_generated':
      return '视频已生成'
    default:
      return '创作中'
  }
}

interface Metadata {
  scriptId?: number
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

/** 从 assistant 消息中解析出生成的 script_id */
function getGeneratedScriptIdFromMessage(message: UIMessage<Metadata>): number | undefined {
  if (message.role !== 'assistant') return undefined
  const fromMetadata = message.metadata?.scriptId
  if (typeof fromMetadata === 'number') return fromMetadata
  for (const part of message.parts) {
    if (!isToolUIPart(part) || getToolName(part) !== 'generate_script') continue
    const scriptId = readRecord('output' in part ? part.output : undefined)?.script_id
    if (typeof scriptId === 'number') return scriptId
  }
  return undefined
}

export default function VideoStoryboard() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const workspaceMode = useWorkspaceMode()
  const isDesktopWorkspace = workspaceMode === 'desktop'
  const [sessionId, setSessionId] = useState(() => (
    getOrCreateUserSessionId(user.id, createSessionId)
  ))
  const [images, setImages] = useState<UploadedImage[]>([])
  const [prompt, setPrompt] = useState('')
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [fileModalOpen, setFileModalOpen] = useState(false)
  const [focusedVideoTaskId, setFocusedVideoTaskId] = useState<string>()
  const [focusedScriptId, setFocusedScriptId] = useState<number>()
  const [videos, setVideos] = useState<VideoTaskItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [scripts, setScripts] = useState<ScriptVersion[]>([])
  const [referencedScriptId, setReferencedScriptId] = useState<number | undefined>()
  const [referencedVideoAsset, setReferencedVideoAsset] = useState<AssetItem | null>(null)
  /** 有值表示当前是「基于原片续写」，值为首段与原片的衔接方式；为空表示编辑原片 */
  const [continuationMode, setContinuationMode] = useState<VideoContinuityMode>()
  /** 待选择衔接方式的续写起点视频 */
  const [continueTask, setContinueTask] = useState<VideoTaskItem | null>(null)
  const [continueDraftMode, setContinueDraftMode] = useState<VideoContinuityMode>('extend')
  const [generationScriptId, setGenerationScriptId] = useState<number | undefined>()
  const [panelTab, setPanelTab] = useState<'assets' | 'scripts' | 'videos'>('assets')
  const [mobileSessionOpen, setMobileSessionOpen] = useState(false)
  const [mobileResourceOpen, setMobileResourceOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const refreshAfterChatRef = useRef(false)
  const historyAbortRef = useRef<AbortController | null>(null)
  const chatStartedRef = useRef(false)
  const latestChatRequestRef = useRef<VideoStoryboardRetryRequest | null>(null)
  const initialSessionResolvedRef = useRef(false)
  const [retryAvailable, setRetryAvailable] = useState(false)
  const [sessionValidated, setSessionValidated] = useState(false)
  /** 有值时表示当前会话存在在途 run，正通过事件重放恢复「过程面板 + 正文」 */
  const [recoveringRun, setRecoveringRun] = useState<{ runId: string; sessionId: string } | null>(null)
  /** 恢复期间合成的 assistant 消息（独立于 useChat，落库后用历史替换） */
  const [recoveryMessage, setRecoveryMessage] = useState<UIMessage | null>(null)
  const recoveryStateRef = useRef<{ runId: string; sessionId: string; state: RunRecoveryState } | null>(null)
  const recoveryUnsubRef = useRef<(() => void) | null>(null)
  /** 恢复视图的合批定时器，避免每个事件都重建整条消息 */
  const recoveryFlushRef = useRef<number | null>(null)

  // 会话 id 只在本次挂载的首个加载结果里解析一次。之后的任何刷新（新建会话、发消息后刷新、
  // 生成完成刷新）都不得改写当前会话：新建的会话还没入库，不在列表里，会被误判成过期缓存
  // 而被"最近的会话"覆盖。
  const handleSessionsLoaded = useCallback((loadedSessions: SessionSummary[]) => {
    if (!initialSessionResolvedRef.current) {
      initialSessionResolvedRef.current = true
      const storageKey = getSessionStorageKey(user.id)
      const resolvedSessionId = resolveInitialSessionId({
        cachedSessionId: localStorage.getItem(storageKey),
        sessions: loadedSessions,
        createSessionId,
      })
      localStorage.setItem(storageKey, resolvedSessionId)
      setSessionId((currentSessionId) => (
        currentSessionId === resolvedSessionId ? currentSessionId : resolvedSessionId
      ))
    }
    setSessionValidated(true)
  }, [user.id])

  const handleSessionsLoadFailed = useCallback(() => {
    // 首个加载失败时也标记已解析，避免后续某次刷新补做解析时覆盖用户刚新建的会话
    initialSessionResolvedRef.current = true
    setSessionValidated(true)
  }, [])

  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
    searchQuery,
    setSearchQuery,
    setIsComposing,
    getCachedSession,
    refresh: loadSessions,
    loadMore: loadMoreSessions,
  } = useSessionList(
    SESSION_PAGE_SIZE,
    handleSessionsLoaded,
    handleSessionsLoadFailed,
  )

  function handleSessionListScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMoreSessions()
    }
  }

  const currentSession = useMemo(
    () => sessions.find((s) => s.sessionId === sessionId) ?? getCachedSession(sessionId),
    [getCachedSession, sessions, sessionId],
  )

  // ===== 素材 / 脚本 / 视频任务 =====
  const loadAssets = useCallback((signal?: AbortSignal) => {
    fetchAssets(sessionId, signal)
      .then((data) => setAssets(data))
      .catch((error) => {
        if (!isAbortError(error)) reportError('video.assets.load', error)
      })
  }, [sessionId])

  const loadScripts = useCallback((signal?: AbortSignal) => {
    fetchScripts(sessionId, signal)
      .then((data) => setScripts(data))
      .catch((error) => {
        if (!isAbortError(error)) reportError('video.scripts.load', error)
      })
  }, [sessionId])

  const loadVideos = useCallback((signal?: AbortSignal) => {
    fetchVideoTasksBySession(sessionId, signal)
      .then((data) => setVideos(data))
      .catch((error) => {
        if (!isAbortError(error)) reportError('video.tasks.load', error)
      })
  }, [sessionId])

  useEffect(() => {
    if (!isSessionResourceLoadReady(sessionValidated)) return
    const controller = new AbortController()
    loadAssets(controller.signal)
    loadScripts(controller.signal)
    loadVideos(controller.signal)
    return () => controller.abort()
  }, [sessionId, sessionValidated, loadAssets, loadScripts, loadVideos])

  const activeVideoTaskIds = useMemo(
    () =>
      videos
        .filter(
          (video) => video.status === 'queued'
            || video.status === 'running'
            || video.status === 'persisting',
        )
        .map((video) => video.taskId)
        .sort()
        .join(','),
    [videos],
  )

  // ===== Chat =====
  const transport = useMemo(
    () => new LatestMessageOnlyTransport(),
    [],
  )

  const { messages, sendMessage, setMessages, status, stop, error, clearError } = useChat<UIMessage>({
    transport,
    throttle: CHAT_UPDATE_THROTTLE_MS,
  })
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])

  const refreshHistoryWhenIdle = useCallback((targetSessionId: string) => {
    if (statusRef.current !== 'ready') return
    historyAbortRef.current?.abort()
    const controller = new AbortController()
    historyAbortRef.current = controller
    fetchHistory(targetSessionId, controller.signal)
      .then((msgs) => {
        if (
          controller.signal.aborted
          || statusRef.current !== 'ready'
          || chatStartedRef.current
        ) return
        setMessages(msgs)
      })
      .catch((error) => {
        if (!isAbortError(error)) reportError('video.history.refresh', error)
      })
      .finally(() => {
        if (historyAbortRef.current === controller) historyAbortRef.current = null
      })
  }, [setMessages])

  // ===== 在途 run 的恢复（刷新 / 切回会话）=====
  /** 断开本地订阅并清空恢复视图；不触碰后端 run（取消只走「停止生成」） */
  const stopRecovery = useCallback(() => {
    recoveryUnsubRef.current?.()
    recoveryUnsubRef.current = null
    recoveryStateRef.current = null
    if (recoveryFlushRef.current !== null) {
      window.clearTimeout(recoveryFlushRef.current)
      recoveryFlushRef.current = null
    }
    setRecoveringRun(null)
    setRecoveryMessage(null)
  }, [])

  /** 订阅 run 事件：先重放已产生的事件，再尾随增量，边收边合成恢复消息 */
  const startRecovery = useCallback((targetSessionId: string, runId: string) => {
    recoveryUnsubRef.current?.()
    if (recoveryFlushRef.current !== null) {
      window.clearTimeout(recoveryFlushRef.current)
      recoveryFlushRef.current = null
    }
    const state = createRunRecoveryState()
    recoveryStateRef.current = { runId, sessionId: targetSessionId, state }
    setRecoveringRun({ runId, sessionId: targetSessionId })
    setRecoveryMessage(buildRecoveredMessage(runId, state))
    void loadScripts()

    // 事件逐个到达，而每次都要重建整条消息；按帧合批，避免逐事件重排把正文挤成一个字一个字往外冒
    const scheduleRecoveryFlush = () => {
      if (recoveryFlushRef.current !== null) return
      recoveryFlushRef.current = window.setTimeout(() => {
        recoveryFlushRef.current = null
        const current = recoveryStateRef.current
        if (!current || current.runId !== runId) return
        setRecoveryMessage(buildRecoveredMessage(runId, current.state))
      }, RECOVERY_UPDATE_THROTTLE_MS)
    }

    const close = subscribeRunEvents(runId, undefined, {
      onEvent: (event) => {
        const current = recoveryStateRef.current
        if (!current || current.runId !== runId) return
        applyRunEvent(current.state, event)
        if (event.type === 'result') void loadScripts()
        scheduleRecoveryFlush()
      },
      onEnd: () => {
        if (recoveryStateRef.current?.runId !== runId) return
        recoveryUnsubRef.current?.()
        recoveryUnsubRef.current = null
        if (recoveryFlushRef.current !== null) {
          window.clearTimeout(recoveryFlushRef.current)
          recoveryFlushRef.current = null
        }
        // 运行已结束：拉取落库后的历史与脚本，替换恢复用的合成消息，避免重复展示
        loadSessions()
        loadVideos()
        loadScripts()
        fetchHistory(targetSessionId)
          .then((msgs) => {
            if (recoveryStateRef.current?.runId !== runId) return
            setMessages(msgs)
            recoveryStateRef.current = null
            setRecoveringRun(null)
            setRecoveryMessage(null)
          })
          .catch((error) => {
            reportError('video.history.refresh', error)
            if (recoveryStateRef.current?.runId !== runId) return
            recoveryStateRef.current = null
            setRecoveringRun(null)
            setRecoveryMessage(null)
          })
      },
      onError: (error) => reportError(`video.run-events.${runId}`, error),
    })
    recoveryUnsubRef.current = close
  }, [loadScripts, loadSessions, loadVideos, setMessages])

  // 挂载 / 切换会话时查询在途 run；有则订阅重放，无则保持历史渲染
  useEffect(() => {
    if (!isSessionResourceLoadReady(sessionValidated)) return
    const controller = new AbortController()
    let disposed = false
    const requestSessionId = sessionId
    fetchActiveRun(requestSessionId, controller.signal)
      .then(({ run }) => {
        if (disposed || !run) return
        startRecovery(requestSessionId, run.runId)
      })
      .catch((error) => {
        if (!isAbortError(error)) reportError('video.active-run.load', error)
      })
    return () => {
      disposed = true
      controller.abort()
      stopRecovery()
    }
  }, [sessionId, sessionValidated, startRecovery, stopRecovery])

  // ===== 长脚本分段生成 =====
  const handlePlanSettled = useCallback(() => {
    loadVideos()
    loadSessions()
    loadScripts()
    refreshHistoryWhenIdle(sessionId)
  }, [loadVideos, loadSessions, loadScripts, refreshHistoryWhenIdle, sessionId])

  const {
    plan: generationPlan,
    pending: planPending,
    startSegmented,
    confirmNext: confirmNextSegment,
    regenerate: regeneratePlanSegment,
    cancel: cancelPlan,
    dismiss: dismissPlan,
  } = useGenerationPlan(sessionId, {
    videos,
    onSettled: handlePlanSettled,
  })

  const handleConfirmNextSegment = useCallback(async (mode: 'extend' | 'frame_bridge') => {
    try {
      await confirmNextSegment(mode)
    } catch (err: unknown) {
      antdMessage.error(`生成下一段失败: ${getErrorMessage(err)}`)
    }
  }, [confirmNextSegment])

  const handleRegenerateSegment = useCallback(async (
    segmentIndex: number,
    mode: 'extend' | 'frame_bridge',
  ) => {
    try {
      await regeneratePlanSegment(segmentIndex, mode)
    } catch (err: unknown) {
      antdMessage.error(`重抽第 ${segmentIndex} 段失败: ${getErrorMessage(err)}`)
    }
  }, [regeneratePlanSegment])

  const handleCancelPlan = useCallback(async () => {
    try {
      await cancelPlan()
      antdMessage.success('已取消分段计划，已完成的分段会保留')
    } catch (err: unknown) {
      antdMessage.error(`取消失败: ${getErrorMessage(err)}`)
    }
  }, [cancelPlan])

  useEffect(() => {
    if (status === 'ready') chatStartedRef.current = false
  }, [status])

  function handleStop() {
    // 显式通知后端中止本次 run（按 sessionId，单会话单链路），
    // 后端 abort 后 SSE 自然收尾并将已生成内容兜底落库；stop() 同时断开本地流。
    void cancelChatRun(sessionId).catch((err: unknown) => {
      reportError(`video.chat-cancel.${sessionId}`, err)
    })
    stop()
    stopRecovery()
    setMessages((currentMessages) => removeStoppedAssistantTurn(currentMessages))
  }

  // 加载当前会话的历史消息
  useEffect(() => {
    if (!isSessionResourceLoadReady(sessionValidated)) return
    const controller = new AbortController()
    historyAbortRef.current?.abort()
    historyAbortRef.current = controller
    const requestSessionId = sessionId
    let disposed = false
    fetchHistory(sessionId, controller.signal)
      .then((msgs) => {
        if (!shouldApplyHistoryResult({
          requestSessionId,
          currentSessionId: sessionId,
          chatStarted: chatStartedRef.current,
          disposed,
        })) return
        if (Array.isArray(msgs) && msgs.length > 0) {
          setMessages(msgs)
        } else {
          setMessages([])
        }
      })
      .catch((error) => {
        if (!isAbortError(error)) reportError('video.history.load', error)
      })
    return () => {
      disposed = true
      controller.abort()
      if (historyAbortRef.current === controller) historyAbortRef.current = null
    }
  }, [sessionId, sessionValidated, setMessages])

  // SSE 订阅活跃任务。终态消息由后端回调写入历史，因此终态后重新加载历史。
  useEffect(() => {
    if (!isSessionResourceLoadReady(sessionValidated)) return
    const taskIds = activeVideoTaskIds ? activeVideoTaskIds.split(',') : []
    const cleanups = taskIds.map((taskId) =>
      subscribeTaskStatus(taskId, (update) => {
        const isTerminal = update.status === 'succeeded'
          || update.status === 'failed'
          || update.status === 'expired'
          || update.status === 'cancelled'
        setVideos((prev) => prev.map((video) => {
          if (video.taskId !== taskId) return video
          return {
            ...video,
            status: update.status ?? video.status,
            generatedVideoUrl: update.generatedVideoUrl ?? video.generatedVideoUrl,
            errorMessage: update.errorMessage ?? video.errorMessage,
          }
        }))
        if (isTerminal) {
          loadVideos()
          loadSessions()
          loadScripts()
          refreshHistoryWhenIdle(sessionId)
        }
      }),
    )

    return () => cleanups.forEach((cleanup) => cleanup())
  }, [
    activeVideoTaskIds,
    loadScripts,
    loadSessions,
    loadVideos,
    refreshHistoryWhenIdle,
    sessionId,
    sessionValidated,
    setMessages,
  ])

  // 会话级占用：本会话流式进行中，或本会话存在正在恢复的在途 run
  const busy = status === 'submitted' || status === 'streaming' || recoveringRun !== null
  const hasUploading = images.some((img) => img.uploading)
  const canSend = sessionValidated
    && status === 'ready'
    && recoveringRun === null
    && !hasUploading
    && (prompt.trim().length > 0 || images.length > 0)

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: status === 'streaming' ? 'auto' : 'smooth',
      })
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [messages, recoveryMessage, status])

  // 仅在当前用户发送的对话完成后刷新，避免历史消息初始加载触发重复请求。
  useEffect(() => {
    if (status === 'ready' && refreshAfterChatRef.current) {
      refreshAfterChatRef.current = false
      const timer = setTimeout(() => {
        loadSessions()
        loadAssets()
        loadScripts()
        loadVideos()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [status, loadSessions, loadAssets, loadScripts, loadVideos])

  // ===== 派生数据 =====
  const latestScript = useMemo(() => {
    if (scripts.length === 0) return null
    return scripts.reduce((latest, s) => (s.version > latest.version ? s : latest), scripts[0])
  }, [scripts])

  const latestStoryboard: ParsedStoryboard | null = useMemo(() => {
    return latestScript ? toParsedStoryboard(latestScript) : null
  }, [latestScript])

  const referencedScript = useMemo(
    () => scripts.find((script) => script.id === referencedScriptId) ?? null,
    [scripts, referencedScriptId],
  )
  const generationScript = useMemo(
    () => scripts.find((script) => script.id === generationScriptId) ?? null,
    [scripts, generationScriptId],
  )
  // 脚本总时长超过单次生成上限时，走分段生成（每段由用户确认后续接）
  const segmentedGeneration = useMemo(
    () => (generationScript
      ? shouldUseSegmentedGeneration(generationScript, MAX_SEGMENT_DURATION_SEC)
      : false),
    [generationScript],
  )
  const referenceAssets = useMemo(
    () => assets.filter((asset) => ['reference', 'all'].includes(asset.assetPurpose)),
    [assets],
  )
  const referenceAssetSummary = useMemo(() => {
    const urls = new Set<string>()
    let imageCount = 0
    let videoCount = 0

    for (const asset of referenceAssets) {
      if (urls.has(asset.url)) continue
      urls.add(asset.url)
      if (asset.assetType === 'video') videoCount += 1
      else if (asset.assetType === 'image') imageCount += 1
    }

    for (const image of images) {
      if (!['reference', 'all'].includes(image.assetPurpose) || urls.has(image.url)) continue
      urls.add(image.url)
      if (image.mediaType.startsWith('video/')) videoCount += 1
      else imageCount += 1
    }

    return { total: urls.size, images: imageCount, videos: videoCount }
  }, [referenceAssets, images])

  // ===== 会话操作 =====
  function handleNewSession() {
    const newId = createSessionId()
    localStorage.setItem(getSessionStorageKey(user.id), newId)
    setSessionId(newId)
    setSessionValidated(true)
    chatStartedRef.current = false
    setMessages([])
    setPrompt('')
    setImages([])
    setFocusedVideoTaskId(undefined)
    setFocusedScriptId(undefined)
    setReferencedScriptId(undefined)
    setReferencedVideoAsset(null)
    setContinuationMode(undefined)
    setGenerationScriptId(undefined)
    refreshAfterChatRef.current = false
    setAssets([])
    setScripts([])
    setVideos([])
    setMobileSessionOpen(false)
    latestChatRequestRef.current = null
    setRetryAvailable(false)
    loadSessions()
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  function handleSwitchSession(newSessionId: string) {
    if (newSessionId === sessionId) return
    // Phase 2 起切换会话是 detach 而非 cancel：只断开本地订阅，后端 run 继续执行，
    // 切回时经 active-run + 事件重放恢复面板与正文。唯一的中止入口是「停止生成」。
    if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
      stop()
    }
    stopRecovery()
    localStorage.setItem(getSessionStorageKey(user.id), newSessionId)
    setSessionId(newSessionId)
    setSessionValidated(true)
    historyAbortRef.current?.abort()
    chatStartedRef.current = false
    setMessages([])
    setPrompt('')
    setImages([])
    setFocusedVideoTaskId(undefined)
    setFocusedScriptId(undefined)
    setReferencedScriptId(undefined)
    setReferencedVideoAsset(null)
    setContinuationMode(undefined)
    setGenerationScriptId(undefined)
    setMobileSessionOpen(false)
    refreshAfterChatRef.current = false
    latestChatRequestRef.current = null
    setRetryAvailable(false)
  }

  // ===== 文件上传 =====
  /** 单个文件：先插入本地预览占位，上传完成后替换成 OSS 地址。 */
  async function uploadOneFile(file: File) {
    const id = createUploadId()
    const name = toUploadFileName(file)
    const mediaType = file.type
    const tempUrl = URL.createObjectURL(file)
    const durationSec = mediaType.startsWith('video/')
      ? await readVideoDuration(tempUrl)
      : undefined
    setImages((prev) => [
      ...prev,
      {
        id,
        url: tempUrl,
        mediaType,
        name,
        assetPurpose: 'all',
        durationSec,
        uploading: true,
      },
    ])

    const formData = new FormData()
    formData.append('file', file, name)

    try {
      const res = await apiFetch('/oss/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const ossUrl = data.url
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, url: ossUrl, uploading: false } : img)),
      )
      URL.revokeObjectURL(tempUrl)
    } catch (err: unknown) {
      antdMessage.error(`上传失败: ${getErrorMessage(err)}`)
      setImages((prev) => prev.filter((img) => img.id !== id))
      URL.revokeObjectURL(tempUrl)
    }
  }

  /** 选择文件和粘贴共用这一条链路，一次可以带入多个文件。 */
  async function uploadFiles(files: File[]) {
    const accepted = files.filter(isUploadableFile)
    if (accepted.length === 0) {
      antdMessage.error('请选择图片或视频文件')
      return
    }
    await Promise.all(accepted.map((file) => uploadOneFile(file)))
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    // 先取快照再清空，否则同一个文件无法连续选择两次
    e.target.value = ''
    if (files.length === 0) return
    void uploadFiles(files)
  }

  /**
   * 粘贴的图片/视频文件走和「添加素材」相同的上传链路。只有确实拿到媒体文件才
   * preventDefault，纯文本粘贴保持浏览器默认行为。
   */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null && isUploadableFile(file))
    if (files.length === 0) return
    e.preventDefault()
    void uploadFiles(files)
  }

  async function handleAddNetworkImage() {
    const url = imageUrlInput.trim()
    if (!url) return
    if (!/^https?:\/\//.test(url)) {
      antdMessage.error('请输入有效的链接（http/https）')
      return
    }

    const id = createUploadId()
    const mediaType = detectMediaTypeFromUrl(url)
    const name = url.split('/').pop() || '网络素材'
    setImages((prev) => [
      ...prev,
      { id, url, mediaType, name, assetPurpose: 'all' },
    ])
    setImageUrlInput('')

    try {
      const actualType = await detectMediaTypeFromNetwork(url)
      const durationSec = actualType.startsWith('video/') ? await readVideoDuration(url) : undefined
      setImages((prev) => prev.map((img) => (
        img.id === id ? { ...img, mediaType: actualType, durationSec } : img
      )))
    } catch (err: unknown) {
      antdMessage.error(`添加素材失败: ${getErrorMessage(err)}`)
      setImages((prev) => prev.filter((img) => img.id !== id))
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const handleDeleteAsset = useCallback(async (asset: AssetItem) => {
    try {
      await deleteAsset(asset.id)
      loadAssets()
    } catch (err: unknown) {
      antdMessage.error(`删除失败: ${getErrorMessage(err)}`)
    }
  }, [loadAssets])

  const handleUpdateAssetPurpose = useCallback(async (
    asset: AssetItem,
    assetPurpose: 'all' | 'analysis' | 'reference',
  ) => {
    try {
      await updateAssetPurpose(asset.id, assetPurpose)
      loadAssets()
    } catch (err: unknown) {
      antdMessage.error(`更新素材用途失败: ${getErrorMessage(err)}`)
    }
  }, [loadAssets])

  // ===== 发送消息 =====
  async function handleSend() {
    if (generationScript) {
      await handleSubmitGeneration()
      return
    }
    if (!canSend) return

    // 上传/添加链接时素材只暂存在 images（不入库），随消息发送后由后端统一入库解析
    const files = images.map((img) => ({
      type: 'file' as const,
      mediaType: img.mediaType,
      url: img.url,
      filename: img.name,
      purpose: img.assetPurpose,
      durationSec: img.durationSec,
    }))
    const request: VideoStoryboardRetryRequest = {
      sessionId,
      text: prompt,
      files,
      body: {
        session_id: sessionId,
        referenced_script_id: referencedScriptId,
        source_video_asset_id: referencedVideoAsset?.id,
        source_video_intent: referencedVideoAsset && continuationMode ? 'continue' : undefined,
        continuity_mode: referencedVideoAsset && continuationMode ? continuationMode : undefined,
      },
    }
    latestChatRequestRef.current = request
    setRetryAvailable(true)
    refreshAfterChatRef.current = true
    historyAbortRef.current?.abort()
    chatStartedRef.current = true
    try {
      await sendMessage(
        { text: request.text, files: request.files },
        { body: request.body },
      )
    } catch (err) {
      refreshAfterChatRef.current = false
      throw err
    }
    setPrompt('')
    setImages([])
  }

  async function handleRetryLatestPrompt() {
    const request = latestChatRequestRef.current
    if (!isRetryForSession(request, sessionId) || busy) return

    clearError()
    historyAbortRef.current?.abort()
    chatStartedRef.current = true
    setMessages((current) => discardFailedEphemeralMessages(current))
    refreshAfterChatRef.current = true
    try {
      const retry = createRetryRequest(request)
      await sendMessage({ text: retry.text, files: retry.files }, { body: retry.body })
    } catch (err) {
      refreshAfterChatRef.current = false
      throw err
    }
  }

  function handleRefreshAfterUnknownOperation() {
    clearError()
    refreshAfterChatRef.current = false
    loadSessions()
    loadAssets()
    loadScripts()
    loadVideos()
    if (!busy) refreshHistoryWhenIdle(sessionId)
  }

  // ===== 引用脚本修改 =====
  const handleQuoteScript = useCallback((script: ScriptVersion) => {
    setReferencedScriptId(script.id)
    setReferencedVideoAsset(null)
    setContinuationMode(undefined)
    setGenerationScriptId(undefined)
    setPrompt('')
  }, [])

  function handleClearReference() {
    setReferencedScriptId(undefined)
    setReferencedVideoAsset(null)
    setContinuationMode(undefined)
  }

  // ===== 使用脚本生成视频 =====
  const handleGenerateVideo = useCallback((scriptId?: number) => {
    const targetId = scriptId ?? latestScript?.id
    if (!targetId) {
      antdMessage.error('没有可生成视频的脚本')
      return
    }
    setGenerationScriptId(targetId)
    setReferencedScriptId(undefined)
    setReferencedVideoAsset(null)
    setContinuationMode(undefined)
    setPrompt('')
    setImages([])
  }, [latestScript])

  /** 把已生成视频挂成引用素材：缺省是编辑原片，传入 continuationMode 则为基于原片续写 */
  const attachVideoReference = useCallback(async (
    task: VideoTaskItem,
    options: { name: string; continuationMode?: VideoContinuityMode },
  ) => {
    if (!task.generatedVideoUrl) {
      antdMessage.error('该视频暂不可作为参考素材')
      return false
    }
    if (!task.scriptId || !scripts.some((script) => script.id === task.scriptId)) {
      antdMessage.error('未找到该视频关联的脚本')
      return false
    }

    try {
      const durationSec = task.duration ?? await readVideoDuration(task.generatedVideoUrl)
      if (!durationSec) {
        antdMessage.error('无法读取原视频时长，暂不能创建任务')
        return false
      }
      const asset = await createAsset({
        session_id: sessionId,
        asset_type: 'video',
        // 编辑原片只作为参考素材使用，不参与视觉解析（后端据此直接落「已解析」）
        asset_purpose: 'reference',
        name: options.name,
        url: task.generatedVideoUrl,
        duration_sec: durationSec,
      })
      setReferencedScriptId(task.scriptId)
      setReferencedVideoAsset(asset)
      setContinuationMode(options.continuationMode)
      setGenerationScriptId(undefined)
      setPrompt('')
      setImages([])
      loadAssets()
      return true
    } catch (err: unknown) {
      antdMessage.error(`引用视频失败: ${getErrorMessage(err)}`)
      return false
    }
  }, [loadAssets, scripts, sessionId])

  const handleReferenceVideo = useCallback((task: VideoTaskItem) => {
    return attachVideoReference(task, { name: '已生成视频（局部修改原片）' })
  }, [attachVideoReference])

  /** 打开「基于此视频续写」的衔接方式选择弹窗 */
  const handleContinueVideo = useCallback((task: VideoTaskItem) => {
    if (!task.generatedVideoUrl) {
      antdMessage.error('该视频暂不可作为续写起点')
      return
    }
    if (!task.scriptId || !scripts.some((script) => script.id === task.scriptId)) {
      antdMessage.error('未找到该视频关联的脚本')
      return
    }
    setContinueDraftMode('extend')
    setContinueTask(task)
  }, [scripts])

  /** 确认衔接方式后，按续写意图挂上原片素材 */
  const handleConfirmContinue = useCallback(async () => {
    if (!continueTask) return
    const attached = await attachVideoReference(continueTask, {
      name: '已生成视频（续写起点）',
      continuationMode: continueDraftMode,
    })
    if (attached) setContinueTask(null)
  }, [attachVideoReference, continueDraftMode, continueTask])

  function handleClearGeneration() {
    setGenerationScriptId(undefined)
    setPrompt('')
    setImages([])
  }

  async function handleSubmitGeneration() {
    if (!generationScript || generating || hasUploading) return

    const assets = images.map((image) => ({
      type: image.mediaType.startsWith('video/') ? 'video' as const : 'image' as const,
      url: image.url,
      name: image.name,
    }))
    const useSegmented = shouldUseSegmentedGeneration(generationScript, MAX_SEGMENT_DURATION_SEC)

    setGenerating(true)
    try {
      if (useSegmented) {
        const plan = await startSegmented({
          script_id: generationScript.id,
          session_id: sessionId,
          user_prompt: prompt.trim() || undefined,
          assets,
        })
        antdMessage.success(
          `脚本时长 ${plan.targetDuration} 秒，已拆成 ${plan.totalSegments} 段，第 1 段正在生成`,
        )
      } else {
        const task = await generateVideo({
          script_id: generationScript.id,
          session_id: sessionId,
          user_prompt: prompt.trim() || undefined,
          assets,
        })
        setVideos((prev) => [task, ...prev])
        antdMessage.success('视频生成任务已提交')
      }
      setGenerationScriptId(undefined)
      setPrompt('')
      setImages([])
      loadAssets()
      loadScripts()
      loadSessions()
      fetchHistory(sessionId)
        .then(setMessages)
        .catch((error) => reportError('video.history.refresh', error))
    } catch (err: unknown) {
      antdMessage.error(`发起生成失败: ${getErrorMessage(err)}`)
    } finally {
      setGenerating(false)
    }
  }

  // ===== 定位聊天中的视频消息 =====
  const handleSelectVideo = useCallback((task: VideoTaskItem) => {
    setFocusedVideoTaskId(task.taskId)
  }, [])

  const handleSelectScriptMessage = useCallback((script: ScriptVersion) => {
    setFocusedScriptId(script.id)
  }, [])

  useEffect(() => {
    if (!focusedVideoTaskId) return

    const frame = requestAnimationFrame(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>('[data-video-task-id]'),
      ).find((element) => element.dataset.videoTaskId === focusedVideoTaskId)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const clearHighlight = window.setTimeout(() => setFocusedVideoTaskId(undefined), 1800)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(clearHighlight)
    }
  }, [focusedVideoTaskId, messages])

  useEffect(() => {
    if (!focusedScriptId) return

    const frame = requestAnimationFrame(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>('[data-script-id]'),
      ).find((element) => element.dataset.scriptId === String(focusedScriptId))
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const clearHighlight = window.setTimeout(() => setFocusedScriptId(undefined), 1800)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(clearHighlight)
    }
  }, [focusedScriptId, messages])

  const handleAddAsset = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // 生成中的会话单独分组，其余归入最近创作
  const generatingSessions = useMemo(
    () => sessions.filter((s) => s.status === 'video_generating'),
    [sessions],
  )
  const recentSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'video_generating'),
    [sessions],
  )

  // ===== 记忆芯片文本 =====
  const memoryText = useMemo(() => {
    const parts: string[] = []
    const brief = currentSession?.creativeBrief
    const subject = brief?.subject ?? brief?.product_name
    const audience = brief?.audience ?? brief?.target_audience
    if (subject) parts.push(subject)
    if (audience) parts.push(audience)
    if (brief?.tone) parts.push(brief.tone)
    if (latestStoryboard) {
      parts.push(`${latestStoryboard.totalDuration} 秒`)
    } else if (brief?.duration) {
      parts.push(`${brief.duration} 秒`)
    }
    if (assets.length > 0) parts.push(`已关联 ${assets.length} 项素材`)
    return parts.join(' · ')
  }, [currentSession, assets, latestStoryboard])

  // 过滤掉无可见内容的 assistant 占位消息（如仅含 data-process-* 的空消息）
  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (msg.role === 'user') return true
      return msg.parts.some((p) => {
        const type = p.type
        if (type === 'data-process-step' || type === 'data-process-complete' || type === 'step-start') {
          return false
        }
        if (type === 'text') {
          return p.text.trim().length > 0
        }
        return true
      })
    })
  }, [messages])

  // 把恢复期间合成的消息并入渲染序列（落库后由历史替换，不会重复）
  const renderedMessages = useMemo(
    () => (recoveryMessage ? [...visibleMessages, recoveryMessage] : visibleMessages),
    [visibleMessages, recoveryMessage],
  )

  const videoAgentErrorAction = useMemo(() => getVideoAgentErrorAction(error), [error])

  useEffect(() => {
    if (error) reportError('video.chat.stream', error)
  }, [error])

  return (
    <div className="lj-app">
      {/* ===== 左侧栏 ===== */}
      {isDesktopWorkspace && (
        <aside className="lj-sidebar">
          <SessionPanel
            sessions={sessions}
            recentSessions={recentSessions}
            generatingSessions={generatingSessions}
            loading={sessionsLoading}
            error={sessionsError}
            searchQuery={searchQuery}
            account={user?.account ?? '用户'}
            activeSessionId={sessionId}
            onSearchChange={setSearchQuery}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onScroll={handleSessionListScroll}
            onRetry={loadSessions}
            onNewSession={handleNewSession}
            onSelectSession={handleSwitchSession}
            onLogout={handleLogout}
            getSessionTitle={(session) => session.creativeBrief?.subject || session.creativeBrief?.product_name || session.topic || '未命名会话'}
            getSessionMeta={(session) => `${sessionStatusText(session.status)} · ${formatRelativeTime(session.updatedAt)}`}
          />
        </aside>
      )}

      {/* ===== 中间主区域 ===== */}
      <main className="lj-main">
        <>
            <div className="lj-mobile-topbar">
              <button
                type="button"
                className="lj-mobile-topbar__button"
                aria-label="打开会话列表"
                onClick={() => setMobileSessionOpen(true)}
              >
                <MenuOutlined />
              </button>
              <div className="lj-mobile-topbar__title">
                {currentSession?.topic || '未命名会话'}
              </div>
              <button
                type="button"
                className="lj-mobile-topbar__button"
                aria-label="打开素材、脚本和视频面板"
                onClick={() => setMobileResourceOpen(true)}
              >
                <FolderOpenOutlined />
              </button>
            </div>
            {/* 顶部状态栏 */}
            <div className="lj-main__header">
              <div className="lj-main__header-left">
                <div className="lj-main__breadcrumb">
                  <span className="lj-bc-item">创作工作台</span>
                  <span className="lj-bc-sep">/</span>
                  <span className="lj-bc-item lj-bc-item--active">对话</span>
                </div>
                <h2 className="lj-main__title">{currentSession?.topic || '未命名会话'}</h2>
              </div>
              <div className="lj-main__status">
                {busy ? (
                  <span className="lj-status-dot lj-status-dot--active">
                    <span className="lj-pulse" /> Agent 正在协作
                  </span>
                ) : (
                  <span className="lj-status-dot">
                    <span className="lj-dot" /> 就绪
                  </span>
                )}
              </div>
            </div>

            {/* 记忆芯片 */}
            {memoryText && (
              <div className="lj-memory-chip">
                <span className="lj-memory-chip__label">当前记忆</span>
                <span className="lj-memory-chip__text">{memoryText}</span>
              </div>
            )}

            {/* 消息区域 */}
            <div className="lj-messages">
              {messages.length === 0 && !busy && (
                <div className="lj-empty-state">
                  <div className="lj-empty-state__icon">
                    <VideoCameraOutlined />
                  </div>
                  <h3>开始你的视频分镜创作</h3>
                  <p>上传商品图片或参考视频，描述你的需求，AI 将为你生成专业的分镜脚本</p>
                  <div className="lj-empty-state__hints">
                    <div className="lj-hint-card">
                      <PictureOutlined />
                      <span>上传素材</span>
                    </div>
                    <div className="lj-hint-card">
                      <VideoCameraOutlined />
                      <span>描述需求</span>
                    </div>
                    <div className="lj-hint-card">
                      <SendOutlined />
                      <span>生成脚本</span>
                    </div>
                  </div>
                </div>
              )}

              {renderedMessages.map((msg, index) => {
                const scriptId = getGeneratedScriptIdFromMessage(msg)
                const matchedScript = scriptId
                  ? scripts.find((s) => s.id === scriptId) ?? null
                  : null
                return (
                  <div
                    key={msg.id || index}
                    className={`lj-script-message-anchor${focusedScriptId !== undefined && scriptId === focusedScriptId ? ' is-focused' : ''}`}
                    data-script-id={scriptId}
                  >
                    <AgentMessage
                      message={msg}
                      isStreaming={index === renderedMessages.length - 1 && busy}
                      script={matchedScript}
                      scripts={scripts}
                      assets={assets}
                      onQuoteScript={handleQuoteScript}
                      onGenerateVideo={handleGenerateVideo}
                      generating={generating}
                      videos={videos}
                      onReferenceVideo={handleReferenceVideo}
                      onContinueVideo={handleContinueVideo}
                      focusedVideoTaskId={focusedVideoTaskId}
                    />
                  </div>
                )
              })}

              {generationPlan && (
                <SegmentPlanPanel
                  plan={generationPlan}
                  pending={planPending}
                  onConfirmNext={handleConfirmNextSegment}
                  onRegenerate={handleRegenerateSegment}
                  onCancel={handleCancelPlan}
                  onDismiss={dismissPlan}
                />
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className={`lj-input-area${busy ? ' is-busy' : ''}`}>
              <div className="lj-input-composer">
                {referencedScript && (
                  <div className="lj-reference-bar">
                    <span>
                      {referencedVideoAsset
                        ? continuationMode
                          ? `正在续写视频 · 原片 ${referencedVideoAsset.parsedContent?.durationSec || '未知'} 秒 · 衔接方式：${continuationMode === 'frame_bridge' ? '尾帧作首帧' : '延长上一段'} · 基于 ${referencedScript.title} V${referencedScript.version}`
                          : `正在修改视频 · ${referencedVideoAsset.parsedContent?.durationSec || '未知'} 秒 · 基于 ${referencedScript.title} V${referencedScript.version}`
                        : `已引用 · ${referencedScript.title} V${referencedScript.version}`}
                    </span>
                    <button
                      type="button"
                      className="lj-reference-bar__clear"
                      aria-label="取消引用脚本"
                      title="取消引用脚本"
                      onClick={handleClearReference}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                )}
                {generationScript && (
                  <div className="lj-generation-context">
                    <div className="lj-generation-context__script">
                      <VideoCameraOutlined />
                      <span className="lj-generation-context__label">
                        {segmentedGeneration ? '分段生成' : '准备生成'}
                      </span>
                      <span className="lj-generation-context__title">
                        {generationScript.title} · V{generationScript.version}
                      </span>
                    </div>
                    {generationScript.meta?.character && generationScript.meta.character.mode !== 'none' && (
                      <Tooltip title={generationScript.meta.character.rolePrompt || '该角色将作为视频主角色'}>
                        <span className="lj-generation-context__character">
                          {generationScript.meta.character.mode === 'user_portrait'
                            ? '上传人像'
                            : '虚拟人像'}
                          {generationScript.meta.character.roleName
                            ? ` · ${generationScript.meta.character.roleName}`
                            : ''}
                        </span>
                      </Tooltip>
                    )}
                    <button
                      type="button"
                      className="lj-generation-context__assets"
                      onClick={() => setPanelTab('assets')}
                      title="查看会话参考素材"
                    >
                      <FolderOpenOutlined />
                      <span>{referenceAssetSummary.total} 项参考素材</span>
                      {referenceAssetSummary.total > 0 && (
                        <span className="lj-generation-context__assets-detail">
                          {referenceAssetSummary.images} 图 / {referenceAssetSummary.videos} 视频
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="lj-generation-context__clear"
                      aria-label="取消视频生成"
                      title="取消视频生成"
                      onClick={handleClearGeneration}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                )}

                {images.length > 0 && (
                  <div className="lj-attached">
                    {images.map((img) => (
                      <div key={img.id} className="lj-attached__item">
                        {img.mediaType.startsWith('video/') ? (
                          <video src={img.url} className="lj-attached__preview" muted />
                        ) : (
                          <Image
                            src={img.url}
                            alt={img.name}
                            width={64}
                            height={64}
                            className="lj-attached__preview"
                            style={{ objectFit: 'cover', opacity: img.uploading ? 0.5 : 1 }}
                            preview={!img.uploading}
                          />
                        )}
                        <CloseCircleFilled
                          className="lj-attached__remove"
                          onClick={() => removeImage(img.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="lj-input-row">
                  <Input.TextArea
                    className="lj-textarea"
                    rows={1}
                    autoSize={{ minRows: 1, maxRows: 5 }}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={generationScript
                      ? '补充画面、动作、风格或禁用元素…'
                      : referencedVideoAsset
                        ? '描述要修改的时间范围和画面内容…'
                      : '补充修改方向，或上传达人、商品素材来生成视频…'}
                    disabled={busy || generating}
                    onPaste={handlePaste}
                    onPressEnter={(e) => {
                      if (!e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                  />

                  <div className="lj-input-toolbar">
                    <div className="lj-input-tools">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        onChange={(e) => {
                          handleFileUpload(e)
                          if (fileModalOpen) setFileModalOpen(false)
                        }}
                        style={{ display: 'none' }}
                      />
                      <Tooltip title="添加素材">
                        <button
                          type="button"
                          className="lj-icon-btn"
                          disabled={busy}
                          onClick={() => setFileModalOpen(true)}
                        >
                          <PaperClipOutlined />
                        </button>
                      </Tooltip>
                      {/* <Tooltip title="素材库">
                        <button
                          type="button"
                          className="lj-icon-btn"
                          onClick={() => setPanelTab('assets')}
                        >
                          <FolderOpenOutlined />
                        </button>
                      </Tooltip> */}
                    </div>

                    {busy && (
                      <span className="lj-input-status">
                        <span className="lj-input-status__dot" />
                        正在处理
                      </span>
                    )}

                    <div className="lj-send-btn">
                      {busy ? (
                        <Tooltip title="停止本轮处理">
                          <Button
                            aria-label="停止本轮处理"
                            className="lj-stop-btn"
                            onClick={handleStop}
                          >
                            <span className="lj-stop-btn__mark" aria-hidden="true" />
                          </Button>
                        </Tooltip>
                      ) : (
                          <Button
                          type="primary"
                          onClick={handleSend}
                          disabled={generationScript ? hasUploading || generating : !canSend}
                        >
                          {generationScript
                            ? segmentedGeneration
                              ? '开始分段生成'
                              : '立即生成'
                            : '发送'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="lj-error">
                  <span>{videoAgentErrorAction?.message ?? error.message}</span>
                  {videoAgentErrorAction?.type === 'retry' && retryAvailable ? (
                    <Button size="small" type="link" onClick={handleRetryLatestPrompt}>
                      重试
                    </Button>
                  ) : videoAgentErrorAction?.type === 'refresh' ? (
                    <Button size="small" type="link" onClick={handleRefreshAfterUnknownOperation}>
                      刷新
                    </Button>
                  ) : (
                    <Button size="small" type="link" onClick={() => clearError()}>
                      关闭
                    </Button>
                  )}
                </div>
              )}
            </div>

            <Modal
              title="基于此视频续写"
              open={Boolean(continueTask)}
              onCancel={() => setContinueTask(null)}
              onOk={handleConfirmContinue}
              okText="开始续写"
              cancelText="取消"
              width={480}
              className="lj-continue-modal"
              destroyOnClose
            >
              <p>
                续写会保留原片的世界观、人物与画风，新脚本与原片结尾衔接。请选择首段与原片的衔接方式：
              </p>
              <Radio.Group
                value={continueDraftMode}
                onChange={(event) => setContinueDraftMode(event.target.value as VideoContinuityMode)}
              >
                <Radio value="extend">延长上一段（推荐）</Radio>
                <Radio value="frame_bridge">尾帧作首帧</Radio>
              </Radio.Group>
            </Modal>

            <Modal
              title="添加素材"
              open={fileModalOpen}
              onCancel={() => setFileModalOpen(false)}
              footer={null}
              width={620}
              className="lj-file-modal"
              destroyOnClose
            >
              <Tabs
                items={[
                  {
                    key: 'local',
                    label: '本地上传',
                    children: (
                      <div
                        className="lj-upload-zone"
                        onClick={() => {
                          fileInputRef.current?.click()
                        }}
                      >
                        <div className="lj-upload-zone__icon">
                          <FileTextOutlined />
                        </div>
                        <div className="lj-upload-zone__title">点击上传图片或视频</div>
                        <div className="lj-upload-zone__hint">支持 JPG、PNG、GIF、MP4、WebM 等格式，也可直接粘贴</div>
                      </div>
                    ),
                  },
                  {
                    key: 'url',
                    label: '在线链接',
                    children: (
                      <div className="lj-url-form">
                        <Input
                          placeholder="粘贴图片或视频链接（http/https）"
                          value={imageUrlInput}
                          onChange={(e) => setImageUrlInput(e.target.value)}
                          disabled={busy}
                        />
                        <Button
                          type="primary"
                          disabled={!imageUrlInput.trim() || busy}
                          onClick={() => {
                            handleAddNetworkImage()
                            setFileModalOpen(false)
                          }}
                          block
                        >
                          添加链接
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </Modal>
        </>
      </main>

      {/* ===== 右侧面板 ===== */}
      {isDesktopWorkspace ? (
        <RightPanel
          assets={assets}
          scripts={scripts}
          videos={videos}
          currentScriptId={latestScript?.id}
          activeTab={panelTab}
          onTabChange={setPanelTab}
          onAddAsset={handleAddAsset}
          onDeleteAsset={handleDeleteAsset}
          onUpdateAssetPurpose={handleUpdateAssetPurpose}
          onSelectScript={handleSelectScriptMessage}
          onSelectVideo={handleSelectVideo}
        />
      ) : (
        <>
          <Drawer
            title="会话"
            placement="left"
            width="min(88vw, 360px)"
            open={!isDesktopWorkspace && mobileSessionOpen}
            onClose={() => setMobileSessionOpen(false)}
            className="lj-mobile-drawer"
            styles={{ body: { padding: 0 } }}
          >
            <SessionPanel
              sessions={sessions}
              recentSessions={recentSessions}
              generatingSessions={generatingSessions}
              loading={sessionsLoading}
              error={sessionsError}
              searchQuery={searchQuery}
              account={user?.account ?? '用户'}
              activeSessionId={sessionId}
              onSearchChange={setSearchQuery}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              onScroll={handleSessionListScroll}
              onRetry={loadSessions}
              onNewSession={handleNewSession}
              onSelectSession={handleSwitchSession}
              onLogout={handleLogout}
              getSessionTitle={(session) => session.creativeBrief?.subject || session.creativeBrief?.product_name || session.topic || '未命名会话'}
              getSessionMeta={(session) => `${sessionStatusText(session.status)} · ${formatRelativeTime(session.updatedAt)}`}
            />
          </Drawer>

          <Drawer
            title="素材与任务"
            placement="right"
            width="min(94vw, 420px)"
            open={!isDesktopWorkspace && mobileResourceOpen}
            onClose={() => setMobileResourceOpen(false)}
            className="lj-mobile-drawer lj-mobile-resource-drawer"
            styles={{ body: { padding: 0 } }}
          >
            <RightPanel
              className="lj-right-panel--drawer"
              assets={assets}
              scripts={scripts}
              videos={videos}
              currentScriptId={latestScript?.id}
              activeTab={panelTab}
              onTabChange={setPanelTab}
              onAddAsset={() => {
                setMobileResourceOpen(false)
                handleAddAsset()
              }}
              onDeleteAsset={handleDeleteAsset}
              onUpdateAssetPurpose={handleUpdateAssetPurpose}
              onSelectScript={(script) => {
                setMobileResourceOpen(false)
                handleSelectScriptMessage(script)
              }}
              onSelectVideo={(video) => {
                setMobileResourceOpen(false)
                handleSelectVideo(video)
              }}
            />
          </Drawer>
        </>
      )}
    </div>
  )
}
