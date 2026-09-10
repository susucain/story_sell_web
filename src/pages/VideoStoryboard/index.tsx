import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage, type ChatTransport, getToolName, isToolUIPart } from 'ai'
import {
  SendOutlined,
  PlusOutlined,
  CloseOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  FileTextOutlined,
  CloseCircleFilled,
} from '@ant-design/icons'
import {
  Button,
  Input,
  Image,
  message as antdMessage,
  Modal,
  Tabs,
  Tooltip,
} from 'antd'
import { AgentMessage } from '../../components/AgentMessage'
import { RightPanel } from './RightPanel'
import type { SessionSummary, AssetItem, ScriptVersion, VideoTaskItem, ParsedStoryboard } from './types'
import { toParsedStoryboard } from './types'
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
} from './api'
import { useSessionList } from './useSessionList'
import { createSessionId } from './session-id'
import './style.css'

const STORAGE_KEY = 'video_storyboard_session_id'
const FALLBACK_USER_ID = 1
const SESSION_PAGE_SIZE = 20
const CHAT_UPDATE_THROTTLE_MS = 80
function getOrCreateSessionId(): string {
  let sessionId = localStorage.getItem(STORAGE_KEY)
  if (!sessionId) {
    sessionId = createSessionId()
    localStorage.setItem(STORAGE_KEY, sessionId)
  }
  return sessionId
}

// 自定义 transport：只发送最新消息，历史由后端从数据库加载
class LatestMessageOnlyTransport extends DefaultChatTransport<UIMessage> {
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
  const [sessionId, setSessionId] = useState(() => getOrCreateSessionId())
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
  const [generationScriptId, setGenerationScriptId] = useState<number | undefined>()
  const [panelTab, setPanelTab] = useState<'assets' | 'scripts' | 'videos'>('assets')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const refreshAfterChatRef = useRef(false)

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
  } = useSessionList(FALLBACK_USER_ID, SESSION_PAGE_SIZE)

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
  const loadAssets = useCallback(() => {
    fetchAssets(sessionId)
      .then((data) => setAssets(data))
      .catch(() => { })
  }, [sessionId])

  const loadScripts = useCallback(() => {
    fetchScripts(sessionId)
      .then((data) => setScripts(data))
      .catch(() => { })
  }, [sessionId])

  const loadVideos = useCallback(() => {
    fetchVideoTasksBySession(sessionId)
      .then((data) => setVideos(data))
      .catch(() => { })
  }, [sessionId])

  useEffect(() => {
    loadAssets()
    loadScripts()
    loadVideos()
  }, [sessionId, loadAssets, loadScripts, loadVideos])

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
    () => new LatestMessageOnlyTransport({ api: '/video/chat' }),
    [],
  )

  const { messages, sendMessage, setMessages, status, stop, error, clearError } = useChat<UIMessage>({
    transport,
    throttle: CHAT_UPDATE_THROTTLE_MS,
  })

  // 加载当前会话的历史消息
  useEffect(() => {
    fetchHistory(sessionId)
      .then((msgs) => {
        if (Array.isArray(msgs) && msgs.length > 0) {
          setMessages(msgs)
        } else {
          setMessages([])
        }
      })
      .catch(() => { })
  }, [sessionId, setMessages])

  // SSE 订阅活跃任务。终态消息由后端回调写入历史，因此终态后重新加载历史。
  useEffect(() => {
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
          fetchHistory(sessionId).then(setMessages).catch(() => { })
        }
      }),
    )

    return () => cleanups.forEach((cleanup) => cleanup())
  }, [
    activeVideoTaskIds,
    loadScripts,
    loadSessions,
    loadVideos,
    sessionId,
    setMessages,
  ])

  const busy = status === 'submitted' || status === 'streaming'
  const hasUploading = images.some((img) => img.uploading)
  const canSend = status === 'ready' && !hasUploading && (prompt.trim().length > 0 || images.length > 0)

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: status === 'streaming' ? 'auto' : 'smooth',
      })
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [messages, status])

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
    localStorage.setItem(STORAGE_KEY, newId)
    setSessionId(newId)
    setMessages([])
    setPrompt('')
    setImages([])
    setFocusedVideoTaskId(undefined)
    setFocusedScriptId(undefined)
    setReferencedScriptId(undefined)
    setReferencedVideoAsset(null)
    setGenerationScriptId(undefined)
    refreshAfterChatRef.current = false
    setAssets([])
    setScripts([])
    setVideos([])
    loadSessions()
  }

  function handleSwitchSession(newSessionId: string) {
    if (newSessionId === sessionId) return
    localStorage.setItem(STORAGE_KEY, newSessionId)
    setSessionId(newSessionId)
    setMessages([])
    setPrompt('')
    setImages([])
    setFocusedVideoTaskId(undefined)
    setFocusedScriptId(undefined)
    setReferencedScriptId(undefined)
    setReferencedVideoAsset(null)
    setGenerationScriptId(undefined)
    refreshAfterChatRef.current = false
  }

  // ===== 文件上传 =====
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      antdMessage.error('请选择图片或视频文件')
      return
    }

    const id = Date.now().toString()
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
        name: file.name,
        assetPurpose: 'all',
        durationSec,
        uploading: true,
      },
    ])

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/oss/upload', { method: 'POST', body: formData })
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

    e.target.value = ''
  }

  async function handleAddNetworkImage() {
    const url = imageUrlInput.trim()
    if (!url) return
    if (!/^https?:\/\//.test(url)) {
      antdMessage.error('请输入有效的链接（http/https）')
      return
    }

    const id = Date.now().toString()
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
    refreshAfterChatRef.current = true
    try {
      await sendMessage(
        { text: prompt, files },
        {
          body: {
            session_id: sessionId,
            referenced_script_id: referencedScriptId,
            source_video_asset_id: referencedVideoAsset?.id,
            user_id: FALLBACK_USER_ID,
          },
        },
      )
    } catch (err) {
      refreshAfterChatRef.current = false
      throw err
    }
    setPrompt('')
    setImages([])
  }

  // ===== 引用脚本修改 =====
  const handleQuoteScript = useCallback((script: ScriptVersion) => {
    setReferencedScriptId(script.id)
    setReferencedVideoAsset(null)
    setGenerationScriptId(undefined)
    setPrompt('')
  }, [])

  function handleClearReference() {
    setReferencedScriptId(undefined)
    setReferencedVideoAsset(null)
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
    setPrompt('')
    setImages([])
  }, [latestScript])

  const handleReferenceVideo = useCallback(async (task: VideoTaskItem) => {
    if (!task.generatedVideoUrl) {
      antdMessage.error('该视频暂不可作为参考素材')
      return
    }
    if (!task.scriptId || !scripts.some((script) => script.id === task.scriptId)) {
      antdMessage.error('未找到该视频关联的脚本')
      return
    }

    try {
      const durationSec = task.duration ?? await readVideoDuration(task.generatedVideoUrl)
      if (!durationSec) {
        antdMessage.error('无法读取原视频时长，暂不能创建修改任务')
        return
      }
      const asset = await createAsset({
        session_id: sessionId,
        user_id: FALLBACK_USER_ID,
        asset_type: 'video',
        asset_purpose: 'all',
        name: '已生成视频（局部修改原片）',
        url: task.generatedVideoUrl,
        duration_sec: durationSec,
      })
      setReferencedScriptId(task.scriptId)
      setReferencedVideoAsset(asset)
      setGenerationScriptId(undefined)
      setPrompt('')
      setImages([])
      loadAssets()
    } catch (err: unknown) {
      antdMessage.error(`引用视频失败: ${getErrorMessage(err)}`)
    }
  }, [loadAssets, scripts, sessionId])

  function handleClearGeneration() {
    setGenerationScriptId(undefined)
    setPrompt('')
    setImages([])
  }

  async function handleSubmitGeneration() {
    if (!generationScript || generating || hasUploading) return

    setGenerating(true)
    try {
      const task = await generateVideo({
        script_id: generationScript.id,
        session_id: sessionId,
        user_id: FALLBACK_USER_ID,
        user_prompt: prompt.trim() || undefined,
        assets: images.map((image) => ({
          type: image.mediaType.startsWith('video/') ? 'video' : 'image',
          url: image.url,
          name: image.name,
        })),
      })
      setVideos((prev) => [task, ...prev])
      antdMessage.success('视频生成任务已提交')
      setGenerationScriptId(undefined)
      setPrompt('')
      setImages([])
      loadAssets()
      loadScripts()
      loadSessions()
      fetchHistory(sessionId).then(setMessages).catch(() => { })
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

  function renderSessionItem(session: SessionSummary) {
    const isGenerating = session.status === 'video_generating'
    return (
      <div
        key={session.sessionId}
        className={`lj-session-item ${session.sessionId === sessionId ? 'active' : ''}`}
        onClick={() => handleSwitchSession(session.sessionId)}
      >
        <div className="lj-session-item__title">{session.productProfile?.product_name || session.topic || '未命名会话'}</div>
        <div className="lj-session-item__meta">
          {isGenerating && <span className="lj-session-item__pulse" />}
          <span>
            {sessionStatusText(session.status)} · {formatRelativeTime(session.updatedAt)}
          </span>
        </div>
      </div>
    )
  }

  // ===== 记忆芯片文本 =====
  const memoryText = useMemo(() => {
    const parts: string[] = []
    const profile = currentSession?.productProfile
    if (profile?.product_name) parts.push(profile.product_name)
    if (profile?.target_audience) parts.push(profile.target_audience)
    if (profile?.tone) parts.push(profile.tone)
    if (latestStoryboard) {
      parts.push(`${latestStoryboard.totalDuration} 秒`)
    } else if (profile?.duration) {
      parts.push(`${profile.duration} 秒`)
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

  const lastAssistantIndex = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === 'assistant') return i
    }
    return -1
  }, [visibleMessages])

  useEffect(() => {
    if(error) {
      console.error(error);
    }
  }, [error])

  return (
    <div className="lj-app">
      {/* ===== 左侧栏 ===== */}
      <aside className="lj-sidebar">
        <div className="lj-sidebar__brand">
          <div className="lj-sidebar__logo"></div>
          <span className="lj-sidebar__brand-name">映语</span>
        </div>

        <div className="lj-sidebar__actions">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleNewSession}
            className="lj-new-btn"
            block
          >
            新对话
          </Button>
          <Input
            placeholder="搜索会话"
            // prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            className="lj-search-input"
            maxLength={64}
            allowClear
          />
        </div>

        <div className="lj-sidebar__list">
          {sessions.length === 0 ? (
            <div className="lj-sidebar__empty">
              {sessionsLoading
                ? '加载中…'
                : sessionsError
                  ? <Button type="link" onClick={loadSessions}>加载失败，点击重试</Button>
                : searchQuery
                  ? '未找到匹配的会话'
                  : '暂无会话，点击新对话开始'}
            </div>
          ) : (
            <>
              {recentSessions.length > 0 && (
                <div className="lj-session-group">
                  <div className="lj-session-group__title">最近创作</div>
                  <div onScroll={handleSessionListScroll} className="lj-session-list">
                    {recentSessions.map(renderSessionItem)}
                  </div>
                </div>
              )}
              {generatingSessions.length > 0 && (
                <div className="lj-session-group">
                  <div className="lj-session-group__title">生成中</div>
                  <div onScroll={handleSessionListScroll} className="lj-session-list">
                    {generatingSessions.map(renderSessionItem)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="lj-sidebar__footer">
          <FolderOpenOutlined />
          <span>个人工作区 · {assets.length + scripts.length + videos.length} 项创作资产</span>
        </div>
      </aside>

      {/* ===== 中间主区域 ===== */}
      <main className="lj-main">
        <>
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

              {visibleMessages.map((msg, index) => {
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
                      isStreaming={index === visibleMessages.length - 1 && busy}
                      isLatestAssistant={index === lastAssistantIndex}
                      script={matchedScript}
                      scripts={scripts}
                      assets={assets}
                      onQuoteScript={handleQuoteScript}
                      onGenerateVideo={handleGenerateVideo}
                      generating={generating}
                      videos={videos}
                      onReferenceVideo={handleReferenceVideo}
                      focusedVideoTaskId={focusedVideoTaskId}
                    />
                  </div>
                )
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className={`lj-input-area${busy ? ' is-busy' : ''}`}>
              <div className="lj-input-composer">
                {referencedScript && (
                  <div className="lj-reference-bar">
                    <span>
                      {referencedVideoAsset
                        ? `正在修改视频 · ${referencedVideoAsset.parsedContent?.durationSec || '未知'} 秒 · 基于 ${referencedScript.title} V${referencedScript.version}`
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
                      <span className="lj-generation-context__label">准备生成</span>
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
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={generationScript
                      ? '补充画面、动作、风格或禁用元素…'
                      : referencedVideoAsset
                        ? '描述要修改的时间范围和画面内容…'
                      : '补充修改方向，或上传达人、商品素材来生成视频…'}
                    disabled={status !== 'ready' || generating}
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
                            onClick={() => stop()}
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
                          {generationScript ? '立即生成' : '发送'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="lj-error">
                  <span>{error.message}</span>
                  <Button size="small" type="link" onClick={() => clearError()}>
                    关闭
                  </Button>
                </div>
              )}
            </div>

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
                        <div className="lj-upload-zone__hint">支持 JPG、PNG、GIF、MP4、WebM 等格式</div>
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
    </div>
  )
}
