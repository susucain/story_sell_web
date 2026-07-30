import type { ParsedStoryboard, StoryboardShot } from './types'

/**
 * 判断一段文本是否包含分镜脚本（包含"镜头"标题模式）
 */
export function isStoryboardMarkdown(text: string): boolean {
  return /#{2,3}\s*镜头\s*\d+/i.test(text)
}

/**
 * 从 markdown 文本中提取字段值
 * 匹配 - **字段名**：值 或 - **字段名**: 值
 */
function extractField(text: string, fieldName: string): string {
  // 匹配 **画面描述**： 或 **画面描述**:
  const re = new RegExp(
    `\\*{2}\\s*${fieldName}\\s*\\*{2}\\s*[:：]\\s*(.+?)(?=\\n-\\s*\\*{2}|\\n---|\\n#{2,3}|\\n##|\\n$|$)`,
    's',
  )
  const m = text.match(re)
  if (!m) return ''
  return m[1].trim().replace(/\s+/g, ' ')
}

/**
 * 解析时间范围字符串，提取秒数
 * 支持: "0s - 3s", "0-3s", "3s - 7s", "11s - 15s"
 */
function parseTimeRange(range: string): { start: number; end: number } {
  const nums = range.match(/\d+/g)
  if (nums && nums.length >= 2) {
    return { start: parseInt(nums[0], 10), end: parseInt(nums[1], 10) }
  }
  return { start: 0, end: 0 }
}

/**
 * 解析分镜脚本 markdown，提取结构化数据
 *
 * 支持的格式：
 * ### 镜头 1：标题 (0s - 3s)
 * - **画面描述**：...
 * - **画面元素**：...
 * - **运镜**：...
 * - **音效**：...
 * - **旁白**：...
 */
export function parseStoryboard(markdown: string): ParsedStoryboard | null {
  if (!markdown || !isStoryboardMarkdown(markdown)) return null

  // 提取标题（第一个 # 标题）
  const titleMatch = markdown.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : '未命名分镜脚本'

  // 提取描述（标题后、第一个镜头前的段落文本）
  let description = ''
  const afterTitle = markdown.slice(titleMatch ? titleMatch.index! + titleMatch[0].length : 0)
  const firstShotIdx = afterTitle.search(/#{2,3}\s*镜头/i)
  if (firstShotIdx > 0) {
    description = afterTitle
      .slice(0, firstShotIdx)
      .replace(/^[\s\n]+/, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 200)
  }

  // 截断到"制作红线检查"之前
  const redLineIdx = markdown.search(/#{2,3}\s*[⚠️]*\s*制作红线/)
  const scriptBody = redLineIdx > 0 ? markdown.slice(0, redLineIdx) : markdown

  // 按 --- 分割镜头块
  const blocks = scriptBody.split(/\n---\s*\n/)

  const shots: StoryboardShot[] = []
  let maxEnd = 0

  for (const block of blocks) {
    // 匹配镜头标题：### 镜头 1：标题 (0s - 3s)  或  ### 镜头 1：标题 (0-3s)
    const headerRe = /#{2,3}\s*镜头\s*(\d+)\s*[：:]\s*(.+?)\s*[（(]\s*([^)）]+)\s*[）)]/
    const headerMatch = block.match(headerRe)
    if (!headerMatch) continue

    const number = parseInt(headerMatch[1], 10)
    const shotTitle = headerMatch[2].trim()
    const timeRange = headerMatch[3].trim()

    const { start, end } = parseTimeRange(timeRange)
    if (end > maxEnd) maxEnd = end

    shots.push({
      number,
      timeRange,
      title: shotTitle,
      visualDescription: extractField(block, '画面描述') || extractField(block, '画面'),
      voiceover: extractField(block, '旁白') || extractField(block, '音频') || extractField(block, '字幕'),
      elements: extractField(block, '画面元素') || undefined,
      camera: extractField(block, '运镜') || undefined,
      sound: extractField(block, '音效') || undefined,
    })
  }

  if (shots.length === 0) return null

  return {
    title,
    description,
    shots,
    totalDuration: maxEnd,
    rawMarkdown: markdown,
  }
}

/**
 * 从对话消息中提取所有图片/视频资产
 */
export function extractAssetsFromText(messages: any[]): import('./types').AssetItem[] {
  const assets: import('./types').AssetItem[] = []
  const seen = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'user') continue
    if (!msg.parts) continue
    for (const part of msg.parts) {
      if (part.type === 'file' && part.url) {
        if (seen.has(part.url)) continue
        seen.add(part.url)
        const isVideo = part.mediaType?.startsWith('video/')
        assets.push({
          id: `${msg.id}-${part.url}`,
          url: part.url,
          type: isVideo ? 'video' : 'image',
          label: isVideo ? '参考视频' : '商品素材',
          status: '已解析',
        })
      }
    }
  }

  return assets
}
