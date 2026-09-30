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

describe('VideoStoryboard composer attachment', () => {
  const OSS_ORIGIN = 'https://oss.example.com/pasted'
  let uploadCount = 0
  let uploadRequests: string[] = []

  beforeAll(() => {
    // antd 组件依赖 ResizeObserver，jsdom 未实现
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    // 消息列表自动滚动会调用 scrollIntoView，jsdom 未实现
    Element.prototype.scrollIntoView = vi.fn()
    // jsdom 未实现对象 URL
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
    vi.mocked(fetchSessions).mockReset()
    vi.mocked(fetchSessions).mockResolvedValue(sessionPage('session-attachment'))
    uploadCount = 0
    uploadRequests = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      let body: unknown = {}
      if (url.includes('/oss/upload')) {
        uploadCount += 1
        uploadRequests.push(url)
        body = { url: `${OSS_ORIGIN}-${uploadCount}.png` }
      }
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => '',
      } as unknown as Response
    }))
  })

  afterEach(() => {
    cleanup()
  })

  /** dispatchEvent 返回 false 说明调用了 preventDefault。 */
  function paste(target: HTMLElement, files: File[]): boolean {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { items: files.map((file) => ({ kind: 'file', getAsFile: () => file })) },
    })
    return target.dispatchEvent(event)
  }

  function composerTextarea(): HTMLTextAreaElement {
    const textarea = document.querySelector<HTMLTextAreaElement>('.lj-textarea')
    if (!textarea) throw new Error('composer textarea not found')
    return textarea
  }

  function attachedSources(): string[] {
    return Array.from(document.querySelectorAll<HTMLImageElement>('.lj-attached__item img'))
      .map((img) => img.src)
  }

  it('uploads the image pasted into the composer', async () => {
    renderWorkspace()
    const textarea = composerTextarea()

    let notPrevented = true
    await act(async () => {
      notPrevented = paste(textarea, [new File(['x'], 'screenshot.png', { type: 'image/png' })])
    })

    expect(notPrevented).toBe(false)
    await waitFor(() => expect(attachedSources()).toEqual([`${OSS_ORIGIN}-1.png`]))
  })

  it('keeps every image when several are pasted at once', async () => {
    renderWorkspace()
    const textarea = composerTextarea()

    await act(async () => {
      paste(textarea, [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.png', { type: 'image/png' }),
      ])
    })

    await waitFor(() => {
      const sources = attachedSources()
      expect(sources).toHaveLength(2)
      expect(sources.every((src) => src.startsWith(OSS_ORIGIN))).toBe(true)
    })
    // id 撞车时两张缩略图会指向同一个地址
    expect(new Set(attachedSources()).size).toBe(2)
  })

  it('leaves a paste without media files to the browser', async () => {
    renderWorkspace()
    const textarea = composerTextarea()

    let notPrevented = false
    await act(async () => {
      notPrevented = paste(textarea, [])
    })

    expect(notPrevented).toBe(true)
    expect(uploadRequests).toEqual([])
  })
})
