import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './auth-context'

export function PublicOnly() {
  const { isLoading, user } = useAuth()
  if (isLoading) return null
  return user ? <Navigate to="/life-video" replace /> : <Outlet />
}
