export type AuthUser = {
  account: string
  avatarUrl?: string | null
  email?: string | null
  id: number
  name?: string | null
  nickname?: string | null
  status: string
}

export type AuthResponse = {
  accessToken: string
  user: AuthUser
}

export type RegisterCredentials = {
  account: string
  confirmPassword: string
  password: string
}

type LoginCredentials = Pick<RegisterCredentials, 'account' | 'password'>

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `HTTP ${response.status}`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

function postCredentials<T>(path: string, body: LoginCredentials | RegisterCredentials): Promise<T> {
  return request<T>(path, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function login(credentials: LoginCredentials): Promise<AuthResponse> {
  return postCredentials<AuthResponse>('/auth/login', credentials)
}

export function register(credentials: RegisterCredentials): Promise<AuthResponse> {
  return postCredentials<AuthResponse>('/auth/register', credentials)
}

export function refresh(): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/refresh', { method: 'POST' })
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

export function getCurrentUser(accessToken: string): Promise<AuthUser> {
  return request<AuthUser>('/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
