import { refresh, type AuthResponse } from '../auth/auth-api'
import { getAccessToken, notifyUnauthorized, setAccessToken } from '../auth/auth-token'
import { reportError } from './report-error'

let refreshPromise: Promise<AuthResponse> | null = null

function refreshAccessToken(): Promise<AuthResponse> {
  if (!refreshPromise) {
    refreshPromise = refresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

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
    const result = await refreshAccessToken()
    setAccessToken(result.accessToken)
    response = await fetch(input, withAuth(init))
  } catch (error) {
    reportError('auth.refresh', error)
    setAccessToken(null)
  }
  if (response.status === 401) notifyUnauthorized()
  return response
}
