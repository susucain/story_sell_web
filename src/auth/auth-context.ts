import { createContext, useContext } from 'react'
import type { AuthUser, RegisterCredentials } from './auth-api'

export type AuthState = {
  accessToken: string | null
  isLoading: boolean
  user: AuthUser | null
}

export type AuthContextValue = AuthState & {
  login: (account: string, password: string) => Promise<void>
  logout: () => Promise<void>
  register: (credentials: RegisterCredentials) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
