import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelGenerationPlan,
  createSegmentedVideo,
  fetchGenerationPlan,
  regenerateSegment,
  startNextSegment,
  subscribeTaskStatus,
} from './api'
import type { VideoContinuityMode, VideoGenerationPlan, VideoTaskItem } from './types'
import { reportError } from '../../lib/report-error'

const ACTIVE_STATUSES = ['queued', 'running', 'persisting']
const TERMINAL_STATUSES = ['succeeded', 'failed', 'expired', 'cancelled']

export interface StartSegmentedBody {
  script_id: number
  session_id: string
  user_prompt?: string
  assets?: Array<{ type: 'image' | 'video'; url: string; name?: string }>
}

interface UseGenerationPlanOptions {
  /** 会话内已有任务，用于刷新后按 planId 恢复计划（与后端持久化约定一致） */
  videos: VideoTaskItem[]
  /** 分段任务进入终态时回调，用于刷新会话、脚本与任务列表 */
  onSettled?: () => void
}

/**
 * 长脚本分段生成的计划状态：创建、逐段确认、重抽、取消，并订阅段级任务状态。
 * 计划本身持久化在后端，刷新后按会话任务里的 planId 恢复。
 */
export function useGenerationPlan(
  sessionId: string,
  { videos, onSettled }: UseGenerationPlanOptions,
) {
  const [plan, setPlan] = useState<VideoGenerationPlan | null>(null)
  const [pending, setPending] = useState(false)
  const [trackedSessionId, setTrackedSessionId] = useState(sessionId)
  const dismissedPlanIdRef = useRef<number | null>(null)
  const onSettledRef = useRef(onSettled)

  useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  // 切换会话时丢弃上一会话的计划（渲染期同步调整状态，避免级联渲染）
  if (trackedSessionId !== sessionId) {
    setTrackedSessionId(sessionId)
    setPlan(null)
  }

  const loadPlan = useCallback(async (planId: number) => {
    const data = await fetchGenerationPlan(planId)
    setPlan(data)
    return data
  }, [])

  // 刷新恢复：本会话任务里最近一次出现的 planId 即当前计划
  useEffect(() => {
    if (plan) return
    const planIds = videos
      .filter((video) => video.sessionId === sessionId)
      .map((video) => video.planId)
      .filter((id): id is number => typeof id === 'number')
    if (planIds.length === 0) return
    const candidate = Math.max(...planIds)
    if (candidate === dismissedPlanIdRef.current) return
    loadPlan(candidate).catch((error) => reportError('video.plan.restore', error))
  }, [plan, videos, sessionId, loadPlan])

  const activeTaskIds = useMemo(
    () =>
      (plan?.tasks ?? [])
        .filter((task) => ACTIVE_STATUSES.includes(task.status))
        .map((task) => task.taskId)
        .sort()
        .join(','),
    [plan],
  )

  const activePlanId = plan?.planId ?? null

  useEffect(() => {
    if (!activeTaskIds) return
    const cleanups = activeTaskIds.split(',').map((taskId) =>
      subscribeTaskStatus(taskId, (update) => {
        setPlan((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            tasks: prev.tasks.map((task) => (
              task.taskId === taskId
                ? {
                  ...task,
                  status: update.status ?? task.status,
                  generatedVideoUrl: update.generatedVideoUrl ?? task.generatedVideoUrl,
                  errorMessage: update.errorMessage ?? task.errorMessage,
                }
                : task
            )),
          }
        })
        if (update.status && TERMINAL_STATUSES.includes(update.status)) {
          if (activePlanId) {
            loadPlan(activePlanId).catch((error) => reportError('video.plan.refresh', error))
          }
          onSettledRef.current?.()
        }
      }),
    )
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [activeTaskIds, activePlanId, loadPlan])

  const startSegmented = useCallback(async (body: StartSegmentedBody) => {
    setPending(true)
    try {
      const data = await createSegmentedVideo(body)
      dismissedPlanIdRef.current = null
      setPlan(data)
      return data
    } finally {
      setPending(false)
    }
  }, [])

  const confirmNext = useCallback(async (continuityMode: VideoContinuityMode) => {
    const current = plan
    if (!current) return
    setPending(true)
    try {
      setPlan(await startNextSegment(current.planId, continuityMode))
    } finally {
      setPending(false)
    }
  }, [plan])

  const regenerate = useCallback(async (
    segmentIndex: number,
    continuityMode: VideoContinuityMode,
  ) => {
    const current = plan
    if (!current) return
    setPending(true)
    try {
      setPlan(await regenerateSegment(current.planId, segmentIndex, continuityMode))
    } finally {
      setPending(false)
    }
  }, [plan])

  const cancel = useCallback(async () => {
    const current = plan
    if (!current) return
    setPending(true)
    try {
      setPlan(await cancelGenerationPlan(current.planId))
    } finally {
      setPending(false)
    }
  }, [plan])

  const dismiss = useCallback(() => {
    dismissedPlanIdRef.current = plan?.planId ?? dismissedPlanIdRef.current
    setPlan(null)
  }, [plan])

  return { plan, pending, startSegmented, confirmNext, regenerate, cancel, dismiss }
}
