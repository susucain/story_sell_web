/** 会话摘要（后端 /video/sessions 返回） */
export interface SessionSummary {
  id: number
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  videoCount: number
  hasGeneratingVideo: boolean
}

/** 单个镜头 */
export interface StoryboardShot {
  number: number
  timeRange: string
  title: string
  visualDescription: string
  voiceover: string
  elements?: string
  camera?: string
  sound?: string
}

/** 解析后的分镜脚本 */
export interface ParsedStoryboard {
  title: string
  description: string
  shots: StoryboardShot[]
  totalDuration: number
  rawMarkdown: string
}

/** 资产卡片 */
export interface AssetItem {
  id: string
  url: string
  type: 'image' | 'video'
  label: string
  status: string
}

/** 脚本版本 */
export interface ScriptVersion {
  id: string
  version: string
  title: string
  shotCount: number
  hasVideo: boolean
  rawMarkdown: string
  parsed: ParsedStoryboard | null
  messageId: string
}

/** 视频任务 */
export interface VideoTaskItem {
  id: number
  taskId: string
  status: string
  prompt: string
  generatedVideoUrl: string | null
  lastFrameUrl: string | null
  duration: number | null
  resolution: string | null
  ratio: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** 视频任务状态枚举 */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled'
