import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthProvider'
import { fetchSessions } from './api'
import VideoStoryboard from './index'
import type { SessionPage } from './types'

vi.mock('./api', () => ({
  fetchSessions: vi.fn(),
  fetchHistory: vi.fn(async () => []),
  fetchAssets: vi.fn(async () => []),
  createAsset: vi.fn(),
  deleteAsset: vi.fn(),
  updateAssetPurpose: vi.fn(),
  fetchScripts: vi.fn(async () => []),
  fetchScriptDetail: vi.fn(),
  generateVideo: vi.fn(),
  fetchVideoTask: vi.fn(),
  fetchVideoTasksBySession: vi.fn(async () => []),
  cancelVideoTask: vi.fn(),
  subscribeTaskStatus: vi.fn(() => () => {}),
}))

const USER = { account: 'creator', id: 7, status: 'active' }
const STORAGE_KEY = `video_storyboard_session_id:${USER.id}`

function sessionPage(...sessionIds: string[]): SessionPage {
  return {
    items: sessionIds.map((sessionId, index) => ({
      id: index + 1,
      sessionId,
      topic: sessionId,
      status: 'completed',
      createdAt: '2026-09-29T02:00:00.000Z',
      updatedAt: '2026-09-29T03:00:00.000Z',
    })),
    total: sessionIds.length,
    page: 1,
    pageSize: 20,
    hasMore: false,
  }
}

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/life-video']}>
      <AuthProvider initialState={{ isLoading: false, user: USER }}>
        <VideoStoryboard />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('VideoStoryboard session identity', () => {
  beforeAll(() => {
    // antd 组件依赖 ResizeObserver，jsdom 未实现
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    // 消息列表自动滚动会调用 scrollIntoView，jsdom 未实现
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    localStorage.clear()
    // 桌面宽度才会渲染带"新对话"按钮的侧边栏
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
    vi.mocked(fetchSessions).mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('restores the most recent session on the first load', async () => {
    vi.mocked(fetchSessions).mockResolvedValue(sessionPage('session-recent', 'session-older'))

    renderWorkspace()

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('session-recent'))
  })

  it('keeps the session created by 新对话 after the list refresh settles', async () => {
    let resolveRefresh: (page: SessionPage) => void = () => {}
    vi.mocked(fetchSessions)
      .mockResolvedValueOnce(sessionPage('session-recent'))
      .mockImplementationOnce(() => new Promise<SessionPage>((resolve) => { resolveRefresh = resolve }))

    renderWorkspace()
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('session-recent'))

    fireEvent.click(screen.getByRole('button', { name: /新对话/ }))
    const createdSessionId = localStorage.getItem(STORAGE_KEY)
    expect(createdSessionId).not.toBe('session-recent')

    await act(async () => {
      resolveRefresh(sessionPage('session-recent', 'session-brand-new'))
    })
    // 刷新结果确实被消费了（新会话出现在列表里），再做断言，避免时序误判
    await waitFor(() => expect(screen.getByText('session-brand-new')).toBeTruthy())

    expect(localStorage.getItem(STORAGE_KEY)).toBe(createdSessionId)
  })
})
