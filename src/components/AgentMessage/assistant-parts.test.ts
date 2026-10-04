import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { collectPhaseRationales, splitAssistantParts } from './assistant-parts'

const message = (parts: unknown[]): UIMessage =>
  ({ id: 'a1', role: 'assistant', parts }) as UIMessage

describe('splitAssistantParts', () => {
  it('classifies step-marked text by the role sent from the backend', () => {
    const { textParts, mainToolParts } = splitAssistantParts(
      message([
        { type: 'step-start' },
        { type: 'text', id: 's0-txt-0', text: '我需要先调用 start_script_creation' },
        { type: 'data-text-meta', data: { stepIndex: 0, interstitial: true } },
        { type: 'tool-start_script_creation', state: 'input-available', input: {} },
        { type: 'step-start' },
        { type: 'text', id: 's1-txt-0', text: '已生成 5 镜头分镜脚本' },
        { type: 'data-text-meta', data: { stepIndex: 1, interstitial: false } },
      ]).parts,
    )

    // 旁白与最终答复都保留，只是角色不同（不删除，避免闪失）
    expect(textParts.map((item) => item.part.text)).toEqual([
      '我需要先调用 start_script_creation',
      '已生成 5 镜头分镜脚本',
    ])
    expect(textParts.map((item) => item.role)).toEqual(['interstitial', 'answer'])
    expect(textParts.map((item) => item.stepIndex)).toEqual([0, 1])
    expect(mainToolParts).toHaveLength(1)
  })

  it('defaults to the answer role until the step role arrives', () => {
    const { textParts } = splitAssistantParts(
      message([
        { type: 'step-start' },
        { type: 'text', id: 's0-txt-0', text: '正在整理素材' },
      ]).parts,
    )

    expect(textParts).toHaveLength(1)
    expect(textParts[0].role).toBe('answer')
  })

  it('keeps the legacy rule for messages stored before step marking', () => {
    const { textParts } = splitAssistantParts(
      message([
        { type: 'text', text: '我需要先调用工具' },
        { type: 'tool-start_script_creation', state: 'input-available', input: {} },
        { type: 'text', text: '最终答复' },
      ]).parts,
    )

    expect(textParts.map((item) => item.part.text)).toEqual(['最终答复'])
    expect(textParts[0].stepIndex).toBeNull()
  })

  it('keeps excluding sub-agent text for legacy messages', () => {
    const { textParts } = splitAssistantParts(
      message([
        { type: 'tool-task', state: 'input-available', input: {} },
        { type: 'text', text: '子 agent 的文本' },
        { type: 'tool-generate_script', state: 'input-available', input: {} },
        { type: 'text', text: '最终答复' },
      ]).parts,
    )

    expect(textParts.map((item) => item.part.text)).toEqual(['最终答复'])
  })
})

describe('collectPhaseRationales', () => {
  const processState = (runningPhaseId: string, runningTitle: string) => ({
    type: 'data-process-state',
    data: {
      status: 'running',
      phases: [
        { id: 'load-guidelines', title: '加载创作规范', description: '', status: 'completed' },
        { id: runningPhaseId, title: runningTitle, description: '', status: 'running' },
      ],
    },
  })

  it('把旁白归到该段文本出现时正在运行的阶段', () => {
    const parts = message([
      processState('generate-script', '提炼卖点并生成分镜脚本'),
      { type: 'text', id: 's0-txt-0', text: '先加载规范' },
      { type: 'data-text-meta', data: { stepIndex: 0, interstitial: true } },
      processState('generate-script', '提炼卖点并生成分镜脚本'),
      { type: 'text', id: 's1-txt-0', text: '开始编写脚本' },
      { type: 'data-text-meta', data: { stepIndex: 1, interstitial: true } },
      { type: 'text', id: 's2-txt-0', text: '最终答复' },
      { type: 'data-text-meta', data: { stepIndex: 2, interstitial: false } },
    ]).parts
    const { textParts } = splitAssistantParts(parts)

    // 最终答复不进入旁白，只保留两段过程旁白
    expect(collectPhaseRationales(parts, textParts)).toEqual([
      { phaseId: 'generate-script', text: '先加载规范' },
      { phaseId: 'generate-script', text: '开始编写脚本' },
    ])
  })

  it('首个过程快照之前出现的旁白归属为 null', () => {
    const parts = message([
      { type: 'text', id: 's0-txt-0', text: '先想想该怎么做' },
      { type: 'data-text-meta', data: { stepIndex: 0, interstitial: true } },
    ]).parts
    const { textParts } = splitAssistantParts(parts)

    expect(collectPhaseRationales(parts, textParts)).toEqual([
      { phaseId: null, text: '先想想该怎么做' },
    ])
  })

  it('没有过程旁白时不产出条目', () => {
    const parts = message([
      { type: 'text', id: 's0-txt-0', text: '最终答复' },
      { type: 'data-text-meta', data: { stepIndex: 0, interstitial: false } },
    ]).parts
    const { textParts } = splitAssistantParts(parts)

    expect(collectPhaseRationales(parts, textParts)).toEqual([])
  })
})
