import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './api-fetch'
import * as authApi from '../auth/auth-api'
import { setAccessToken } from '../auth/auth-token'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setAccessToken('expired-token')
  })

  it('shares one refresh request across concurrent 401 responses', async () => {
    const refreshSpy = vi.spyOn(authApi, 'refresh').mockResolvedValue({
      accessToken: 'fresh-token',
      user: { id: 1, account: 'dev', status: 'active' },
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const first = apiFetch('/video/sessions')
    const second = apiFetch('/video/history/session')
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })
})
