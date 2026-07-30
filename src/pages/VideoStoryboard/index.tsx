import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { debounce } from 'lodash-es'
import {
  UploadOutlined,
  LinkOutlined,
  DeleteOutlined,
  SendOutlined,
  StopOutlined,
  PlusOutlined,
  SearchOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import {
  Button,
  Input,
  Image,
  Space,
  message as antdMessage,
  Tag,
  Popover,
  Tooltip,
} from 'antd'
import { AgentMessage } from '../../components/AgentMessage'
import { ScriptCard } from './ScriptCard'
import { RightPanel } from './RightPanel'
import { VideoPreview } from './VideoPreview'
import { parseStoryboard, isStoryboardMarkdown, extractAssetsFromText } from './storyboard-parser'
import type { SessionSummary, AssetItem, ScriptVersion, VideoTaskItem, ParsedStoryboard } from './types'
import './style.css'

const STORAGE_KEY = 'video_storyboard_session_id'

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
  async sendMessages(options: Parameters<DefaultChatTransport<UIMessage>['sendMessages']>[0]) {
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

function formatSessionTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  if (isToday) return `${hours}:${minutes}`
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

export default function VideoStoryboard() {
  const [sessionId, setSessionId] = useState(() => getOrCreateSessionId())
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [images, setImages] = useState<UploadedImage[]>([])
  const [prompt, setPrompt] = useState('')
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [detectingIds, setDetectingIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<'chat' | 'preview'>('chat')
  const [selectedVideoTask, setSelectedVideoTask] = useState<VideoTaskItem | null>(null)
  const [videos, setVideos] = useState<VideoTaskItem[]>([])
  const [generating, setGenerating] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ===== 会话列表 =====
  const fetchSessions = useCallback(() => {
    fetch('/video/sessions')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: SessionSummary[]) => {
        if (Array.isArray(data)) setSessions(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const currentSession = useMemo(
    () => sessions.find((s) => s.sessionId === sessionId),
    [sessions, sessionId],
  )

  // ===== 视频任务列表 + 轮询 =====
  const fetchVideos = useCallback(() => {
    fetch(`/video/tasks/session/${sessionId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: VideoTaskItem[]) => {
        if (Array.isArray(data)) setVideos(data)
      })
      .catch(() => {})
  }, [sessionId])

  useEffect(() => {
    fetchVideos()
  }, [fetchVideos])

  // 有活跃任务时轮询
  const hasActiveTask = videos.some(
    (v) => v.status === 'queued' || v.status === 'running',
  )
  useEffect(() => {
    if (!hasActiveTask) return
    const timer = setInterval(() => {
      fetchVideos()
      fetchSessions()
    }, 5000)
    return () => clearInterval(timer)
  }, [hasActiveTask, fetchVideos, fetchSessions])

  // ===== Chat =====
  const transport = useMemo(
    () => new LatestMessageOnlyTransport({ api: '/video/chat' }),
    [],
  )

  const { messages, sendMessage, setMessages, status, stop, error, clearError } = useChat<UIMessage>({
    transport,
  })

  // 加载当前会话的历史消息
  useEffect(() => {
    fetch(`/video/history/${sessionId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((msgs: UIMessage[]) => {
        if (Array.isArray(msgs) && msgs.length > 0) {
          setMessages(msgs)
        } else {
          setMessages([])
        }
      })
      .catch(() => {})
  }, [sessionId, setMessages])

  const busy = status === 'submitted' || status === 'streaming'
  const hasUploading = images.some((img) => img.uploading)
  const canSend = status === 'ready' && !hasUploading && (prompt.trim().length > 0 || images.length > 0)

  const debouncedScroll = useMemo(
    () => debounce(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100),
    [],
  )

  useEffect(() => {
    debouncedScroll()
  }, [messages, debouncedScroll])

  // 发送完成后刷新会话列表和视频任务
  useEffect(() => {
    if (status === 'ready' && messages.length > 0) {
      const timer = setTimeout(() => {
        fetchSessions()
        fetchVideos()
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 派生数据：资产、脚本 =====
  const assets: AssetItem[] = useMemo(
    () => extractAssetsFromText(messages),
    [messages],
  )

  const scripts: ScriptVersion[] = useMemo(() => {
    const result: ScriptVersion[] = []
    let versionNum = 0
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue
      if (!msg.parts) continue
      for (const part of msg.parts) {
        if (part.type !== 'text') continue
        if (isStoryboardMarkdown(part.text)) {
          versionNum++
          const parsed = parseStoryboard(part.text)
          result.push({
            id: `${msg.id}-script-${versionNum}`,
            version: `V${versionNum}`,
            title: parsed?.title ?? '未命名脚本',
            shotCount: parsed?.shots.length ?? 0,
            hasVideo: videos.some((v) => v.status === 'succeeded'),
            rawMarkdown: part.text,
            parsed,
            messageId: msg.id,
          })
        }
      }
    }
    return result
  }, [messages, videos])

  /** 最新解析出的分镜（用于视频预览） */
  const latestStoryboard: ParsedStoryboard | null = useMemo(() => {
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].parsed) return scripts[i].parsed
    }
    return null
  }, [scripts])

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
    setVideos([])
    fetchSessions()
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
    setImages((prev) => [...prev, { id, url: tempUrl, mediaType, uploading: true }])

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/oss/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, url: data.url, uploading: false } : img)),
      )
      URL.revokeObjectURL(tempUrl)
    } catch (err: any) {
      antdMessage.error(`上传失败: ${err.message}`)
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
    setImages((prev) => [...prev, { id, url, mediaType }])
    setImageUrlInput('')

    setDetectingIds((prev) => new Set(prev).add(id))
    const actualType = await detectMediaTypeFromNetwork(url)
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, mediaType: actualType } : img)))
    setDetectingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  // ===== 发送消息 =====
  async function handleSend() {
    if (!canSend) return
    const files = images.map((img) => ({
      type: 'file' as const,
      mediaType: img.mediaType,
      url: img.url,
    }))
    await sendMessage({ text: prompt, files }, { body: { session_id: sessionId } })
    setPrompt('')
    setImages([])
  }

  // ===== 引用脚本修改 =====
  function handleQuoteScript(script: ScriptVersion) {
    const quoteText = `请基于 ${script.version} 脚本进行修改：${script.title}\n\n请告诉我你希望调整的部分。`
    setPrompt(quoteText)
  }

  // ===== 使用脚本生成视频 =====
  async function handleGenerateVideo() {
    setGenerating(true)
    setView('chat')
    try {
      await sendMessage(
        { text: '使用当前分镜脚本生成视频' },
        { body: { session_id: sessionId } },
      )
    } catch (err: any) {
      antdMessage.error(`发起生成失败: ${err.message}`)
    } finally {
      setGenerating(false)
    }
  }

  // ===== 查看视频预览 =====
  function handleSelectVideo(task: VideoTaskItem) {
    setSelectedVideoTask(task)
    setView('preview')
  }

  // ===== 抑制分镜文本（AgentMessage 中不显示原始 markdown） =====
  const suppressStoryboard = useCallback((text: string): React.ReactNode | null => {
    if (isStoryboardMarkdown(text)) return <Fragment />
    return null
  }, [])

  // ===== 预计算每条消息的分镜（避免在渲染循环中调用 hooks） =====
  const storyboardsByMsgId = useMemo(() => {
    const map = new Map<string, ParsedStoryboard>()
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.parts) continue
      for (const part of msg.parts) {
        if (part.type === 'text' && isStoryboardMarkdown(part.text)) {
          const parsed = parseStoryboard(part.text)
          if (parsed) {
            map.set(msg.id, parsed)
            break
          }
        }
      }
    }
    return map
  }, [messages])

  // ===== 筛选会话 =====
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const q = searchQuery.toLowerCase()
    return sessions.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, searchQuery])

  // ===== 记忆芯片文本 =====
  const memoryText = useMemo(() => {
    if (!currentSession) return ''
    const parts: string[] = [currentSession.title]
    if (assets.length > 0) parts.push(`已关联 ${assets.length} 项素材`)
    if (latestStoryboard) parts.push(`${latestStoryboard.totalDuration} 秒`)
    return parts.join(' · ')
  }, [currentSession, assets, latestStoryboard])

  return (
    <div className="lj-app">
      {/* ===== 左侧栏 ===== */}
      <aside className="lj-sidebar">
        <div className="lj-sidebar__brand">
          <div className="lj-sidebar__logo">灵</div>
          <span className="lj-sidebar__brand-name">灵剪 AI</span>
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
            prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="lj-search-input"
            allowClear
          />
        </div>

        <div className="lj-sidebar__list">
          {filteredSessions.length === 0 ? (
            <div className="lj-sidebar__empty">
              {searchQuery ? '未找到匹配的会话' : '暂无会话，点击新对话开始'}
            </div>
          ) : (
            filteredSessions.map((session) => (
              <div
                key={session.sessionId}
                className={`lj-session-item ${session.sessionId === sessionId ? 'active' : ''}`}
                onClick={() => handleSwitchSession(session.sessionId)}
              >
                <div className="lj-session-item__title">{session.title}</div>
                <div className="lj-session-item__meta">
                  <span>{formatSessionTime(session.updatedAt)}</span>
                  {session.hasGeneratingVideo && (
                    <Tag color="processing" className="lj-session-item__badge">
                      生成中
                    </Tag>
                  )}
                  {session.videoCount > 0 && !session.hasGeneratingVideo && (
                    <span className="lj-session-item__videos">
                      {session.videoCount} 个视频
                    </span>
                  )}
                </div>
              </div>
            ))
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
            sessionTitle={currentSession?.title ?? '视频分镜'}
            onBack={() => setView('chat')}
          />
        ) : (
          <>
            {/* 顶部状态栏 */}
            <div className="lj-main__header">
              <div className="lj-main__breadcrumb">
                <span className="lj-bc-item">创作工作台</span>
                <span className="lj-bc-sep">/</span>
                <span className="lj-bc-item lj-bc-item--active">对话</span>
                {currentSession && (
                  <>
                    <span className="lj-bc-sep">·</span>
                    <span className="lj-bc-session">{currentSession.title}</span>
                  </>
                )}
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

              {messages.map((msg, index) => {
                const isLast = index === messages.length - 1
                const msgStoryboard = storyboardsByMsgId.get(msg.id) ?? null

                return (
                  <Fragment key={msg.id || index}>
                    <AgentMessage
                      message={msg}
                      isStreaming={isLast && busy}
                      renderFinalText={suppressStoryboard}
                    />
                    {/* 分镜脚本卡片（消息完成后显示） */}
                    {msgStoryboard && !(isLast && busy) && (
                      <ScriptCard
                        parsed={msgStoryboard}
                        assets={assets}
                        onQuoteScript={() => {
                          const script = scripts.find((s) => s.messageId === msg.id)
                          if (script) handleQuoteScript(script)
                        }}
                        onGenerateVideo={handleGenerateVideo}
                        generating={generating}
                      />
                    )}
                  </Fragment>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className="lj-input-area">
              {images.length > 0 && (
                <div className="lj-attached">
                  {images.map((img) => (
                    <div key={img.id} className="lj-attached__item">
                      {img.mediaType.startsWith('video/') ? (
                        <video src={img.url} className="lj-attached__preview" muted />
                      ) : (
                        <Image
                          src={img.url}
                          alt="reference"
                          width={64}
                          height={64}
                          className="lj-attached__preview"
                          style={{ objectFit: 'cover', opacity: img.uploading ? 0.5 : 1 }}
                          preview={!img.uploading}
                        />
                      )}
                      <DeleteOutlined
                        className="lj-attached__remove"
                        onClick={() => removeImage(img.id)}
                      />
                      {img.uploading ? (
                        <Tag color="processing" className="lj-attached__tag">上传中</Tag>
                      ) : (
                        <Tag color="success" className="lj-attached__tag">已上传</Tag>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="lj-input-row">
                <div className="lj-input-tools">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                  <Tooltip title="上传图片/视频">
                    <Button
                      type="text"
                      icon={<UploadOutlined />}
                      disabled={busy}
                      onClick={() => fileInputRef.current?.click()}
                      className="lj-tool-btn"
                    />
                  </Tooltip>
                  <Popover
                    content={
                      <Space>
                        <Input
                          placeholder="输入素材链接 URL"
                          value={imageUrlInput}
                          onChange={(e) => setImageUrlInput(e.target.value)}
                          onPressEnter={handleAddNetworkImage}
                          style={{ width: 280 }}
                          disabled={busy}
                          suffix={
                            <LinkOutlined
                              onClick={handleAddNetworkImage}
                              style={{ cursor: 'pointer' }}
                            />
                          }
                        />
                      </Space>
                    }
                    title="添加网络素材"
                    trigger="click"
                  >
                    <Tooltip title="网络链接">
                      <Button
                        type="text"
                        icon={<LinkOutlined />}
                        disabled={busy}
                        className="lj-tool-btn"
                      />
                    </Tooltip>
                  </Popover>
                </div>

                <Input.TextArea
                  className="lj-textarea"
                  rows={1}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你的视频需求，或引用脚本进行修改..."
                  disabled={status !== 'ready'}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                />

                <div className="lj-send-btn">
                  {busy ? (
                    <Button danger shape="circle" icon={<StopOutlined />} onClick={() => stop()} />
                  ) : (
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<SendOutlined />}
                      onClick={handleSend}
                      disabled={!canSend}
                    />
                  )}
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
          </>
        )}
      </main>

      {/* ===== 右侧面板 ===== */}
      <RightPanel
        assets={assets}
        scripts={scripts}
        videos={videos}
        onAddAsset={() => fileInputRef.current?.click()}
        onSelectScript={(script) => handleQuoteScript(script)}
        onSelectVideo={handleSelectVideo}
      />
    </div>
  )
}
