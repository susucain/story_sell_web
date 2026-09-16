import { describe, expect, it, vi } from 'vitest'
import { register } from './auth-api'

describe('register', () => {
  it('posts credentials and returns the authenticated user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accessToken: 'access-token',
      user: { account: 'creator', id: 2, status: 'active' },
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(register({
      account: 'creator',
      confirmPassword: 'StrongPassword123!',
      password: 'StrongPassword123!',
    })).resolves.toEqual({
      accessToken: 'access-token',
      user: { account: 'creator', id: 2, status: 'active' },
    })

    expect(fetchMock).toHaveBeenCalledWith('/auth/register', {
      body: JSON.stringify({
        account: 'creator',
        confirmPassword: 'StrongPassword123!',
        password: 'StrongPassword123!',
      }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  })
})
