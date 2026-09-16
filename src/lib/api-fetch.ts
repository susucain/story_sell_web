import { refresh } from '../auth/auth-api'
import { getAccessToken, notifyUnauthorized, setAccessToken } from '../auth/auth-token'

function withAuth(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers)
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return { ...init, credentials: 'include', headers }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response = await fetch(input, withAuth(init))
  if (response.status !== 401) return response
  try {
    const result = await refresh()
    setAccessToken(result.accessToken)
    response = await fetch(input, withAuth(init))
  } catch {
    setAccessToken(null)
  }
  if (response.status === 401) notifyUnauthorized()
  return response
}
