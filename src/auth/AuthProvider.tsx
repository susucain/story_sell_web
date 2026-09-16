import { useEffect, useState, type PropsWithChildren } from 'react'
import { login as loginRequest, logout as logoutRequest, refresh, register as registerRequest, type AuthUser } from './auth-api'
import { setAccessToken, setUnauthorizedHandler } from './auth-token'
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context'

type AuthProviderProps = PropsWithChildren<{
  initialState?: Partial<AuthState>
}>

export function AuthProvider({ children, initialState }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    accessToken: initialState?.accessToken ?? null,
    isLoading: initialState?.isLoading ?? true,
    user: initialState?.user ?? null,
  })

  function applyAuth(result: { accessToken: string; user: AuthUser }) {
    setAccessToken(result.accessToken)
    setState({ accessToken: result.accessToken, isLoading: false, user: result.user })
  }

  useEffect(() => {
    if (initialState) return
    refresh()
      .then((result) => applyAuth(result))
      .catch(() => { setAccessToken(null); setState({ accessToken: null, isLoading: false, user: null }) })
  }, [initialState])

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ accessToken: null, isLoading: false, user: null }))
    return () => setUnauthorizedHandler(null)
  }, [])

  const value: AuthContextValue = {
    ...state,
    login: async (account, password) => applyAuth(await loginRequest({ account, password })),
    logout: async () => {
      await logoutRequest()
      setAccessToken(null)
      setState({ accessToken: null, isLoading: false, user: null })
    },
    register: async (credentials) => applyAuth(await registerRequest(credentials)),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
