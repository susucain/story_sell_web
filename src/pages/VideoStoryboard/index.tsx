import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { UploadOutlined, LinkOutlined, DeleteOutlined, SendOutlined, StopOutlined } from '@ant-design/icons'
import { Button, Input, Image, Space, message as antdMessage, Tag, Popover } from 'antd'
import { StreamdownText } from '../../components/StreamdownText'
import { ToolCallDisplay } from '../../components/ToolCallDisplay'
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
    // 只发送最后一条消息
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
  return 'image/jpeg'
}

async function detectMediaTypeFromNetwork(url: string): Promise<string> {
  try {
    const resp = await fetch(url, { method: 'HEAD' })
    const ct = resp.headers.get('content-type')
    if (ct && ct.startsWith('image/')) return ct
  } catch {
    // fallback to URL-based detection
  }
  return detectMediaTypeFromUrl(url)
}

export default function VideoStoryboard() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [prompt, setPrompt] = useState('')
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [detectingIds, setDetectingIds] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef(images)
  imagesRef.current = images

  const transport = new LatestMessageOnlyTransport({
    api: '/video/chat',
  })

  const { messages, sendMessage, setMessages, status, stop, error, clearError } = useChat<UIMessage>({
    transport,
  })

  // 加载历史消息（仅用于展示，发送时只发最新消息）
  useEffect(() => {
    const sessionId = localStorage.getItem(STORAGE_KEY)
    if (!sessionId) return
    fetch(`/video/history/${sessionId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((msgs: UIMessage[]) => {
        if (Array.isArray(msgs) && msgs.length > 0) {
          setMessages(msgs)
        }
      })
      .catch(() => {
        // 静默失败
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const busy = status === 'submitted' || status === 'streaming'
  const hasUploading = images.some((img) => img.uploading)
  const canSend = status === 'ready' && !hasUploading && (prompt.trim().length > 0 || images.length > 0)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      antdMessage.error('请选择图片文件')
      return
    }

    const id = Date.now().toString()
    const mediaType = file.type

    // Add placeholder image while uploading
    const tempUrl = URL.createObjectURL(file)
    setImages((prev) => [...prev, { id, url: tempUrl, mediaType, uploading: true }])

    // Upload to OSS
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/oss/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
      }

      const data = await res.json()
      // Update with the actual OSS URL
      setImages((prev) =>
        prev.map((img) =>
          img.id === id ? { ...img, url: data.url, uploading: false } : img,
        ),
      )
      URL.revokeObjectURL(tempUrl)
    } catch (err: any) {
      antdMessage.error(`上传失败: ${err.message}`)
      // Remove the failed image
      setImages((prev) => prev.filter((img) => img.id !== id))
      URL.revokeObjectURL(tempUrl)
    }

    e.target.value = ''
  }

  async function handleAddNetworkImage() {
    const url = imageUrlInput.trim()
    if (!url) return
    if (!/^https?:\/\//.test(url)) {
      antdMessage.error('请输入有效的图片链接（http/https）')
      return
    }

    const id = Date.now().toString()
    const mediaType = detectMediaTypeFromUrl(url)
    setImages((prev) => [...prev, { id, url, mediaType }])
    setImageUrlInput('')

    // Probe actual content-type in background
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

  async function handleSend() {
    if (!canSend) return
    const files = images.map((img) => ({
      type: 'file' as const,
      mediaType: img.mediaType,
      url: img.url,
    }))
    await sendMessage({ text: prompt, files }, { body: { session_id: getOrCreateSessionId() } })
    setPrompt('')
    setImages([])
  }

  return (
    <div className="video-storyboard-layout">
      {/* Top: Messages area */}
      <div className="video-storyboard-messages">
        {messages.length === 0 && (
          <div className="storyboard-empty">
            <p>上传参考图片并输入提示词，点击生成开始对话</p>
          </div>
        )}
        {messages.map((msg, index) => (
          <div key={msg.id ?? index} className={`storyboard-bubble storyboard-bubble--${msg.role}`}>
            <div className="storyboard-role">
              {msg.role === 'user' ? '你' : '助手'}
            </div>
            <div className="storyboard-content">
              {msg.parts.map((part, i) =>
                part.type === 'text' ? (
                  <div key={i} className="storyboard-text">
                    {msg.role === 'assistant' ? (
                      <StreamdownText isStreaming={busy && i === msg.parts.length - 1}>
                        {part.text}
                      </StreamdownText>
                    ) : (
                      part.text
                    )}
                  </div>
                ) : part.type === 'file' ? (
                  <div key={i} className="storyboard-image">
                    <Image
                      src={part.url}
                      alt="reference"
                      style={{ maxWidth: 200, maxHeight: 200, borderRadius: 6 }}
                      preview
                    />
                  </div>
                ) : part.type.startsWith('tool-') || part.type === 'dynamic-tool' ? (
                  <ToolCallDisplay key={i} part={part} />
                ) : null,
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom: Input area (fixed) */}
      <div className="video-storyboard-input">
        {/* Attached images preview */}
        {images.length > 0 && (
          <div className="storyboard-attached-images">
            {images.map((img) => (
              <div key={img.id} className="storyboard-attached-img">
                <Image
                  src={img.url}
                  alt="reference"
                  width={64}
                  height={64}
                  style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee', opacity: img.uploading ? 0.5 : 1 }}
                  preview={!img.uploading}
                />
                <DeleteOutlined
                  className="storyboard-attached-img-remove"
                  onClick={() => removeImage(img.id)}
                />
                {detectingIds.has(img.id) && (
                  <Tag style={{ position: 'absolute', top: -8, right: -8, margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    探测中
                  </Tag>
                )}
                {img.uploading ? (
                  <Tag
                    color="processing"
                    style={{ position: 'absolute', bottom: 2, left: 2, margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 3px' }}
                  >
                    上传中
                  </Tag>
                ) : (
                  <Tag
                    color="success"
                    style={{ position: 'absolute', bottom: 2, left: 2, margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 3px' }}
                  >
                    已上传
                  </Tag>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="storyboard-input-row">
          <div className="storyboard-input-tools">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <Button
              type="text"
              icon={<UploadOutlined />}
              disabled={busy}
              title="上传图片"
              onClick={() => fileInputRef.current?.click()}
            >
              上传
            </Button>
            <Popover
              content={
                <Space>
                  <Input
                    placeholder="输入网络图片URL"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    onPressEnter={handleAddNetworkImage}
                    style={{ width: 280 }}
                    disabled={busy}
                    suffix={
                      <LinkOutlined onClick={handleAddNetworkImage} style={{ cursor: 'pointer' }} />
                    }
                  />
                </Space>
              }
              title="添加网络图片"
              trigger="click"
            >
              <Button type="text" icon={<LinkOutlined />} disabled={busy} title="网络图片">
                链接
              </Button>
            </Popover>
          </div>

          <Input.TextArea
            className="storyboard-textarea"
            rows={1}
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入提示词..."
            disabled={status !== 'ready'}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />

          <div className="storyboard-send-btn">
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
          <div className="storyboard-error">
            <span>{error.message}</span>
            <Button size="small" type="link" onClick={() => clearError()}>
              关闭
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
