/** 会话级商品画像（video_sessions.product_profile） */
export interface ProductProfile {
  product_name?: string
  selling_points?: string[]
  target_audience?: string
  duration?: number
  platform?: string
  tone?: string
}

/** 后端 /video/sessions 返回的会话摘要 */
export interface SessionSummary {
  id: number
  sessionId: string
  topic: string | null
  status: string
  productProfile?: ProductProfile | null
  createdAt: string
  updatedAt: string
}

/** 后端 /video/sessions 分页响应 */
export interface SessionPage {
  items: SessionSummary[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** 后端 video_scripts.shots 数组中的单个镜头 */
export interface StoryboardShot {
  shot: number
  time: string
  scene: string
  visual: string
  audio: string
}

/** 后端 video_scripts.meta 字段 */
export interface ScriptMeta {
  duration?: number
  ratio?: string
  style?: string
  platform?: string
  description?: string
  hashtags?: string[]
}

/** 后端 /video/scripts/:sessionId 或 /video/scripts/:id/detail 返回的脚本 */
export interface ScriptVersion {
  id: number
  sessionId: string
  userId: number
  version: number
  title: string
  hook: string
  shots: StoryboardShot[]
  scriptMarkdown: string
  seedancePrompt: string
  meta: ScriptMeta | null
  sourceMessageId: number | null
  basedOnVersion: number | null
  status: 'draft' | 'confirmed' | 'used_for_video'
  createdAt: string
}

/** 后端 video_assets 表 */
export interface AssetItem {
  id: number
  sessionId: string
  userId: number
  assetType: 'image' | 'video' | 'url'
  assetPurpose: 'analysis' | 'reference'
  name: string
  url: string
  thumbnailUrl: string | null
  parsedContent: Record<string, any> | null
  status: 'pending' | 'parsed' | 'failed'
  createdAt: string
  updatedAt: string
}

/** 后端 video_tasks 表 */
export interface VideoTaskItem {
  id: number
  sessionId: string
  userId: number
  scriptId: number | null
  taskId: string
  model: string
  status: TaskStatus
  prompt: string | null
  imageUrls: string | null
  videoUrls: string | null
  generatedVideoUrl: string | null
  lastFrameUrl: string | null
  duration: number | null
  resolution: string | null
  ratio: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** 视频任务状态枚举 */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled'

/** 前端用于 ScriptCard / VideoPreview 的统一分镜结构 */
export interface ParsedStoryboard {
  id: number
  version: number
  title: string
  description: string
  shots: StoryboardShot[]
  totalDuration: number
  ratio: string
  style: string
  platform: string
  rawMarkdown: string
}

/** 把后端 ScriptVersion 转成前端 ParsedStoryboard */
export function toParsedStoryboard(script: ScriptVersion): ParsedStoryboard {
  const meta = script.meta ?? {}
  const maxEnd = script.shots.reduce((max, s) => {
    const nums = s.time.match(/\d+/g)
    const end = nums && nums.length >= 2 ? parseInt(nums[1], 10) : 0
    return Math.max(max, end)
  }, 0)
  return {
    id: script.id,
    version: script.version,
    title: script.title,
    description: meta.description || script.hook || '',
    shots: script.shots,
    totalDuration: meta.duration || maxEnd || 15,
    ratio: meta.ratio || '9:16',
    style: meta.style || '真实口播',
    platform: meta.platform || '抖音/小红书',
    rawMarkdown: script.scriptMarkdown,
  }
}
