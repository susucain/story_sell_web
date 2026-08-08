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
  CloseCircleFilled
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
import { VideoPreview } from './VideoPreview'
import type { SessionSummary, AssetItem, ScriptVersion, VideoTaskItem, ParsedStoryboard } from './types'
import { toParsedStoryboard } from './types'
import {
  fetchSessions,
  fetchHistory,
  fetchAssets,
  deleteAsset,
  fetchScripts,
  generateVideo,
  fetchVideoTasksBySession,
  subscribeTaskStatus,
} from './api'
import './style.css'

const STORAGE_KEY = 'video_storyboard_session_id'
const FALLBACK_USER_ID = 1
const SESSION_PAGE_SIZE = 20
const CHAT_UPDATE_THROTTLE_MS = 80

function getOrCreateSessionId(): string {
  let sessionId = localStorage.getItem(STORAGE_KEY)
  if (!sessionId) {
    sessionId = crypto.randomUUID()
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
  assetPurpose: 'analysis' | 'reference'
  uploading?: boolean
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
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [images, setImages] = useState<UploadedImage[]>([])
  const [prompt, setPrompt] = useState('')
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [fileModalOpen, setFileModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<'chat' | 'preview'>('chat')
  const [selectedVideoTask, setSelectedVideoTask] = useState<VideoTaskItem | null>(null)
  const [videos, setVideos] = useState<VideoTaskItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [scripts, setScripts] = useState<ScriptVersion[]>([])
  const [referencedScriptId, setReferencedScriptId] = useState<number | undefined>()
  const [panelTab, setPanelTab] = useState<'assets' | 'scripts' | 'videos'>('assets')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ===== 会话列表（分页：默认一页 7 条，滚动到底部加载下一页） =====
  const loadSessions = useCallback(() => {
    setSessionsLoading(true)
    fetchSessions(FALLBACK_USER_ID, 1, SESSION_PAGE_SIZE)
      .then((data) => {
        setSessions(data.items)
        setSessionsHasMore(data.hasMore)
      })
      .catch(() => { })
      .finally(() => setSessionsLoading(false))
  }, [])

  const loadMoreSessions = useCallback(() => {
    if (sessionsLoading || !sessionsHasMore) return
    setSessionsLoading(true)
    const nextPage = Math.floor(sessions.length / SESSION_PAGE_SIZE) + 1
    fetchSessions(FALLBACK_USER_ID, nextPage, SESSION_PAGE_SIZE)
      .then((data) => {
        setSessions((prev) => {
          const seen = new Set(prev.map((s) => s.sessionId))
          return [...prev, ...data.items.filter((s) => !seen.has(s.sessionId))]
        })
        setSessionsHasMore(data.hasMore)
      })
      .catch(() => { })
      .finally(() => setSessionsLoading(false))
  }, [sessionsLoading, sessionsHasMore, sessions.length])

  function handleSessionListScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMoreSessions()
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(loadSessions, 0)
    return () => window.clearTimeout(timer)
  }, [loadSessions])

  const currentSession = useMemo(
    () => sessions.find((s) => s.sessionId === sessionId),
    [sessions, sessionId],
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
        .filter((video) => video.status === 'queued' || video.status === 'running')
        .map((video) => video.taskId)
        .sort()
        .join(','),
    [videos],
  )

  // SSE 订阅活跃任务
  useEffect(() => {
    const taskIds = activeVideoTaskIds ? activeVideoTaskIds.split(',') : []
    const cleanups = taskIds.map((taskId) =>
      subscribeTaskStatus(taskId, (update) => {
        setVideos((prev) => {
          let changed = false
          const next = prev.map((video) => {
            if (video.taskId !== taskId) return video

            const status = update.status ?? video.status
            const generatedVideoUrl =
              update.generatedVideoUrl ?? video.generatedVideoUrl
            const errorMessage = update.errorMessage ?? video.errorMessage

            if (
              status === video.status &&
              generatedVideoUrl === video.generatedVideoUrl &&
              errorMessage === video.errorMessage
            ) {
              return video
            }

            changed = true
            return {
              ...video,
              status,
              generatedVideoUrl,
              errorMessage,
            }
          })
          return changed ? next : prev
        })
      }),
    )

    return () => cleanups.forEach((c) => c())
  }, [activeVideoTaskIds])

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

  // 发送完成后刷新数据
  useEffect(() => {
    if (status === 'ready' && messages.length > 0) {
      const timer = setTimeout(() => {
        loadSessions()
        loadAssets()
        loadScripts()
        loadVideos()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [status, messages.length, loadSessions, loadAssets, loadScripts, loadVideos])

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

  // ===== 会话操作 =====
  function handleNewSession() {
    const newId = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, newId)
    setSessionId(newId)
    setMessages([])
    setPrompt('')
    setImages([])
    setView('chat')
    setSelectedVideoTask(null)
    setReferencedScriptId(undefined)
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
    setView('chat')
    setSelectedVideoTask(null)
    setReferencedScriptId(undefined)
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
    setImages((prev) => [
      ...prev,
      { id, url: tempUrl, mediaType, name: file.name, assetPurpose: 'analysis', uploading: true },
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
      { id, url, mediaType, name, assetPurpose: 'reference' },
    ])
    setImageUrlInput('')

    try {
      const actualType = await detectMediaTypeFromNetwork(url)
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, mediaType: actualType } : img)))
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

  // ===== 发送消息 =====
  async function handleSend() {
    if (!canSend) return

    // 上传/添加链接时素材只暂存在 images（不入库），随消息发送后由后端统一入库解析
    const files = images.map((img) => ({
      type: 'file' as const,
      mediaType: img.mediaType,
      url: img.url,
      filename: img.name,
      purpose: img.assetPurpose,
    }))
    await sendMessage(
      { text: prompt, files },
      {
        body: {
          session_id: sessionId,
          referenced_script_id: referencedScriptId,
          user_id: FALLBACK_USER_ID,
        },
      },
    )
    setPrompt('')
    setImages([])
    setReferencedScriptId(undefined)
  }

  // ===== 引用脚本修改 =====
  const handleQuoteScript = useCallback((script: ScriptVersion) => {
    setReferencedScriptId(script.id)
    setPrompt('')
  }, [])

  function handleClearReference() {
    setReferencedScriptId(undefined)
  }

  // ===== 使用脚本生成视频 =====
  const handleGenerateVideo = useCallback(async (scriptId?: number) => {
    const targetId = scriptId ?? latestScript?.id
    if (!targetId) {
      antdMessage.error('没有可生成视频的脚本')
      return
    }
    setGenerating(true)
    try {
      const task = await generateVideo({ script_id: targetId })
      setVideos((prev) => [task, ...prev])
      antdMessage.success('视频生成任务已提交')
    } catch (err: unknown) {
      antdMessage.error(`发起生成失败: ${getErrorMessage(err)}`)
    } finally {
      setGenerating(false)
    }
  }, [latestScript])

  // ===== 查看视频预览 =====
  const handleSelectVideo = useCallback((task: VideoTaskItem) => {
    setSelectedVideoTask(task)
    setView('preview')
  }, [])

  const handleAddAsset = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // ===== 筛选会话 =====
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const q = searchQuery.toLowerCase()
    return sessions.filter((s) => (s.topic || '').toLowerCase().includes(q))
  }, [sessions, searchQuery])

  // 生成中的会话单独分组，其余归入最近创作
  const generatingSessions = useMemo(
    () => filteredSessions.filter((s) => s.status === 'video_generating'),
    [filteredSessions],
  )
  const recentSessions = useMemo(
    () => filteredSessions.filter((s) => s.status !== 'video_generating'),
    [filteredSessions],
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
            placeholder="搜索会话、脚本或视频"
            // prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="lj-search-input"
            allowClear
          />
        </div>

        <div className="lj-sidebar__list">
          {filteredSessions.length === 0 ? (
            <div className="lj-sidebar__empty">
              {sessionsLoading
                ? '加载中…'
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
        {view === 'preview' && selectedVideoTask ? (
          <VideoPreview
            videoTask={selectedVideoTask}
            parsed={latestStoryboard}
            sessionTitle={currentSession?.topic ?? '视频分镜'}
            onBack={() => setView('chat')}
          />
        ) : (
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
                  <AgentMessage
                    key={msg.id || index}
                    message={msg}
                    isStreaming={index === visibleMessages.length - 1 && busy}
                    isLatestAssistant={index === lastAssistantIndex}
                    script={matchedScript}
                    scripts={scripts}
                    assets={assets}
                    onQuoteScript={handleQuoteScript}
                    onGenerateVideo={handleGenerateVideo}
                    generating={generating}
                  />
                )
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className="lj-input-area">
              <div className="lj-input-composer">
                {referencedScript && (
                  <div className="lj-reference-bar">
                    <span>已引用 · {referencedScript.title} V{referencedScript.version}</span>
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
                    placeholder="补充修改方向，或上传达人、商品素材来生成视频…"
                    disabled={status !== 'ready'}
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
                      <Tooltip title="素材库">
                        <button
                          type="button"
                          className="lj-icon-btn"
                          onClick={() => setPanelTab('assets')}
                        >
                          <FolderOpenOutlined />
                        </button>
                      </Tooltip>
                    </div>

                    <div className="lj-send-btn">
                      {busy ? (
                        <Button danger onClick={() => stop()}>停止</Button>
                      ) : (
                        <Button
                          type="primary"
                          onClick={handleSend}
                          disabled={!canSend}
                        >
                          发送
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
        )}
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
        onSelectScript={handleQuoteScript}
        onSelectVideo={handleSelectVideo}
      />
    </div>
  )
}
