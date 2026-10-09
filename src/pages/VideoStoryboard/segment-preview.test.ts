import { describe, expect, it } from 'vitest'
import {
  getPreviewShots,
  getPreviewTitle,
  isSupersededSegmentTask,
  resolveSegmentPreviewContext,
} from './segment-preview'
import type { ParsedStoryboard, VideoGenerationPlan, VideoTaskItem } from './types'

const task: VideoTaskItem = {
  id: 7,
  sessionId: 'session-1',
  userId: 1,
  scriptId: 11,
  taskId: 'segment-2-task',
  model: 'seedance',
  status: 'succeeded',
  prompt: null,
  imageUrls: null,
  videoUrls: null,
  generatedVideoUrl: 'https://example.test/segment-2.mp4',
  lastFrameUrl: null,
  duration: 10,
  resolution: '720p',
  ratio: '9:16',
  planId: 3,
  segmentIndex: 2,
  continuityMode: 'extend',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
}

const plan: VideoGenerationPlan = {
  planId: 3,
  sessionId: 'session-1',
  scriptId: 11,
  targetDuration: 30,
  segmentDuration: 15,
  totalSegments: 2,
  completedSegments: 2,
  status: 'completed',
  assembledVideoUrl: null,
  scriptTitle: '布偶猫桃花笑拟人舞',
  ratio: '9:16',
  continuation: null,
  segments: [
    { index: 1, startSec: 0, endSec: 15, duration: 15, requestDuration: 15, shotCount: 2, shots: [{ shot: 1, scene: '开场', continues: false, hasAudio: true }, { shot: 2, scene: '主歌', continues: false, hasAudio: true }] },
    { index: 2, startSec: 15, endSec: 30, duration: 15, requestDuration: 15, shotCount: 2, shots: [{ shot: 3, scene: '副歌', continues: false, hasAudio: true }, { shot: 4, scene: '结尾', continues: false, hasAudio: true }] },
  ],
  tasks: [
    { taskId: 'segment-2-task', segmentIndex: 2, status: 'succeeded', continuityMode: 'extend', duration: 15, generatedVideoUrl: 'https://example.test/segment-2.mp4', lastFrameUrl: null, errorMessage: null },
  ],
}

const parsed: ParsedStoryboard = {
  id: 11,
  version: 6,
  title: '布偶猫桃花笑拟人舞',
  description: '',
  shots: [
    { shot: 1, time: '0-4s', scene: '开场', visual: '', audio: '' },
    { shot: 2, time: '4-15s', scene: '主歌', visual: '', audio: '' },
    { shot: 3, time: '15-20s', scene: '副歌', visual: '', audio: '' },
    { shot: 4, time: '20-30s', scene: '结尾', visual: '', audio: '' },
  ],
  totalDuration: 30,
  ratio: '9:16',
  style: '',
  platform: '',
  basedOnVersion: null,
  rawMarkdown: '',
}

describe('segment preview', () => {
  it('projects a task onto its own segment title and local timeline', () => {
    const context = resolveSegmentPreviewContext(task, plan)

    expect(context).toMatchObject({ index: 2, startSec: 15, endSec: 30 })
    expect(getPreviewTitle(parsed.title, context)).toBe('布偶猫桃花笑拟人舞 Part 2 (15-30s)')
    expect(getPreviewShots(parsed, context)).toEqual([
      expect.objectContaining({ shot: 3, time: '0-5s' }),
      expect.objectContaining({ shot: 4, time: '5-15s' }),
    ])
  })

  it('keeps ordinary videos on the complete script path', () => {
    const ordinaryTask = { ...task, planId: null, segmentIndex: null }

    expect(resolveSegmentPreviewContext(ordinaryTask, plan)).toBeNull()
    expect(getPreviewTitle(parsed.title, null)).toBe(parsed.title)
    expect(getPreviewShots(parsed, null)).toEqual(parsed.shots)
  })

  it('hides a cancelled task after a regenerated task replaces it', () => {
    const cancelledTask = { ...task, taskId: 'old-segment-2-task', status: 'cancelled' as const }
    const regeneratedPlan = {
      ...plan,
      tasks: [
        ...plan.tasks,
        { ...plan.tasks[0], taskId: 'old-segment-2-task', status: 'cancelled' as const },
      ],
    }

    expect(isSupersededSegmentTask(cancelledTask, regeneratedPlan)).toBe(true)
  })
})
