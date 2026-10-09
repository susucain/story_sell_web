import type {
  GenerationPlanSegment,
  ParsedStoryboard,
  SegmentPreviewContext,
  StoryboardShot,
  VideoGenerationPlan,
  VideoTaskItem,
} from './types'

function formatSecond(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function getShotRange(shot: StoryboardShot): { start: number; end: number } | null {
  const values = shot.time.match(/\d+(?:\.\d+)?/g)
  if (!values || values.length < 2) return null
  const start = Number(values[0])
  const end = Number(values[1])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

function toContext(
  segment: GenerationPlanSegment,
  totalSegments: number,
): SegmentPreviewContext {
  return {
    index: segment.index,
    totalSegments,
    startSec: segment.startSec,
    endSec: segment.endSec,
    shots: segment.shots,
  }
}

export function resolveSegmentPreviewContext(
  task: VideoTaskItem,
  plan: VideoGenerationPlan | undefined,
): SegmentPreviewContext | null {
  if (
    typeof task.planId !== 'number'
    || typeof task.segmentIndex !== 'number'
    || plan?.planId !== task.planId
  ) {
    return null
  }
  const segment = plan.segments.find((item) => item.index === task.segmentIndex)
  return segment ? toContext(segment, plan.totalSegments) : null
}

export function isSupersededSegmentTask(
  task: VideoTaskItem | undefined,
  plan: VideoGenerationPlan | undefined,
): boolean {
  if (
    task?.status !== 'cancelled'
    || typeof task.planId !== 'number'
    || typeof task.segmentIndex !== 'number'
    || plan?.planId !== task.planId
  ) {
    return false
  }
  return plan.tasks.some((candidate) => (
    candidate.segmentIndex === task.segmentIndex
    && candidate.taskId !== task.taskId
    && candidate.status !== 'cancelled'
  ))
}

export function getPreviewTitle(
  title: string | undefined,
  context: SegmentPreviewContext | null,
): string {
  if (!context) return title ?? '视频预览'
  return `${title ?? '视频预览'} Part ${context.index} (${formatSecond(context.startSec)}-${formatSecond(context.endSec)}s)`
}

export function getPreviewShots(
  parsed: ParsedStoryboard | null,
  context: SegmentPreviewContext | null,
): StoryboardShot[] {
  const shots = parsed?.shots ?? []
  if (!context) return shots

  const allowedShots = new Set(context.shots.map((shot) => shot.shot))
  return shots.flatMap((shot) => {
    if (!allowedShots.has(shot.shot)) return []
    const range = getShotRange(shot)
    if (!range) return [shot]

    const localStart = Math.max(0, range.start - context.startSec)
    const localEnd = Math.min(context.endSec - context.startSec, range.end - context.startSec)
    if (localEnd <= localStart) return []

    return [{
      ...shot,
      time: `${formatSecond(localStart)}-${formatSecond(localEnd)}s`,
    }]
  })
}
