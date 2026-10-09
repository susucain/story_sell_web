/** 会话级创作简报（video_sessions.product_profile，垂类无关） */
export interface CreativeBrief {
  vertical?: string
  subject?: string
  key_points?: string[]
  audience?: string
  duration?: number
  platform?: string
  tone?: string
  constraints?: string[]
  /** 历史会话字段（改名前为商品画像），保留读取兼容 */
  product_name?: string
  selling_points?: string[]
  target_audience?: string
}

/** 后端 /video/sessions 返回的会话摘要 */
export interface SessionSummary {
  id: number
  sessionId: string
  topic: string | null
  status: string
  creativeBrief?: CreativeBrief | null
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
  character?: CharacterMeta
  edit?: VideoEditMeta
  continuation?: VideoContinuationMeta
}

export interface CharacterMeta {
  mode: 'user_portrait' | 'preset_avatar' | 'none'
  roleName?: string
  rolePrompt?: string
  primaryAssetId?: number
  presetAvatarId?: string
  presetAlias?: string
  selectionSource: 'user_explicit' | 'auto_selected' | 'inherited'
}

export interface VideoEditMeta {
  mode: 'full_video_edit'
  sourceAssetId: number
  sourceDurationSec: number
  targetStartSec: number
  targetEndSec: number
  preserveAudio: boolean
}

/** 后端 video_scripts.meta.continuation：基于已生成视频续写新剧情 */
export interface VideoContinuationMeta {
  mode: 'continuation'
  /** 被续写的原片素材 ID */
  sourceAssetId: number
  /** 原片时长（秒） */
  sourceDurationSec: number
  /** 首段与原片的衔接方式 */
  continuityMode: VideoContinuityMode
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
  assetPurpose: 'all' | 'analysis' | 'reference'
  contentCategory: 'portrait' | 'product' | 'food' | 'store' | 'environment' | 'other' | null
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
  /** 关联的分段生成计划，单段任务为空 */
  planId: number | null
  /** 所属分段序号（从 1 开始），单段任务为空 */
  segmentIndex: number | null
  /** 衔接方式：延长上一段 / 尾帧作首帧 */
  continuityMode: VideoContinuityMode | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** 视频任务状态枚举 */
export type TaskStatus = 'queued' | 'running' | 'persisting' | 'succeeded' | 'failed' | 'expired' | 'cancelled'

/** 分段之间的衔接方式 */
export type VideoContinuityMode = 'extend' | 'frame_bridge'

/** 分段生成计划的整体状态 */
export type GenerationPlanStatus =
  | 'planning'
  | 'generating'
  | 'awaiting_confirm'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 计划中的单段镜头摘要 */
export interface GenerationPlanShot {
  shot: number
  scene: string
  continues: boolean
  hasAudio: boolean
}

/** 计划中的单段规划信息 */
export interface GenerationPlanSegment {
  index: number
  startSec: number
  endSec: number
  duration: number
  requestDuration: number
  shotCount: number
  shots: GenerationPlanShot[]
}

/** 聊天流中某个分段视频预览所需的段级上下文 */
export interface SegmentPreviewContext {
  index: number
  totalSegments: number
  startSec: number
  endSec: number
  shots: GenerationPlanShot[]
}

/** 计划中单段对应的任务状态 */
export interface GenerationPlanTask {
  taskId: string
  segmentIndex: number | null
  status: TaskStatus
  continuityMode: VideoContinuityMode | null
  duration: number | null
  generatedVideoUrl: string | null
  lastFrameUrl: string | null
  errorMessage: string | null
}

/** 后端 /video/generate/plan/:planId 返回的分段生成计划 */
export interface VideoGenerationPlan {
  planId: number
  sessionId: string
  scriptId: number
  targetDuration: number
  segmentDuration: number
  totalSegments: number
  completedSegments: number
  status: GenerationPlanStatus
  assembledVideoUrl: string | null
  scriptTitle: string
  ratio: string | null
  /** 非空表示这是续写脚本的分段计划，第 1 段承接原片 */
  continuation: {
    sourceDurationSec: number
    continuityMode: VideoContinuityMode
  } | null
  segments: GenerationPlanSegment[]
  tasks: GenerationPlanTask[]
}

/** 前端用于 ScriptCard / 视频消息预览的统一分镜结构 */
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
  character?: CharacterMeta
  edit?: VideoEditMeta
  continuation?: VideoContinuationMeta
  /** 基于哪一版脚本生成（续写脚本用于标注承接来源） */
  basedOnVersion: number | null
  rawMarkdown: string
}

/** 与后端 resolveTargetDuration 对齐：取声明时长与最后一个镜头结束时间的较大值 */
export function resolveScriptDuration(script: ScriptVersion): number {
  const declared = Number(script.meta?.duration)
  const lastShotEnd = script.shots.reduce((max, shot) => {
    const match = /(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-~–—]\s*(\d+(?:\.\d+)?)/.exec(shot.time)
    if (!match) return max
    const end = Number(match[2])
    return Number.isFinite(end) ? Math.max(max, end) : max
  }, 0)
  return Math.max(Number.isFinite(declared) && declared > 0 ? declared : 0, lastShotEnd)
}

/**
 * 是否走分段生成：与后端 createPlan 判定一致。
 * 局部视频编辑复用原片时长，不支持分段生成。
 */
export function shouldUseSegmentedGeneration(script: ScriptVersion, maxDuration: number): boolean {
  if (script.meta?.edit) return false
  return resolveScriptDuration(script) > maxDuration
}

/** 把后端 ScriptVersion 转成前端 ParsedStoryboard */
export function toParsedStoryboard(script: ScriptVersion): ParsedStoryboard {
  const meta = script.meta ?? {}
  const fallbackEditShot: StoryboardShot | undefined = meta.edit && script.shots.length === 0
    ? {
      shot: 1,
      time: `${meta.edit.targetStartSec}-${meta.edit.targetEndSec}s`,
      scene: '视频局部编辑',
      visual: meta.description || '仅修改指定时间段，其余画面保持原视频不变',
      audio: meta.edit.preserveAudio ? '保留原视频音频' : '',
    }
    : undefined
  const shots = fallbackEditShot ? [fallbackEditShot] : script.shots
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
    shots,
    totalDuration: meta.edit?.sourceDurationSec || meta.duration || maxEnd || 15,
    ratio: meta.ratio || '9:16',
    style: meta.style || '真实口播',
    platform: meta.platform || '抖音/小红书',
    character: meta.character,
    edit: meta.edit,
    continuation: meta.continuation,
    basedOnVersion: script.basedOnVersion,
    rawMarkdown: script.scriptMarkdown,
  }
}
