import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'

export function RequireAuth() {
  const { isLoading, user } = useAuth()
  const location = useLocation()
  if (isLoading) return null
  return user
    ? <Outlet />
    : <Navigate to="/login" replace state={{ from: location }} />
}
