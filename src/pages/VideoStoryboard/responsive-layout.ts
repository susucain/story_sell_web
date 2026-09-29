import { useEffect, useState } from 'react'

export type WorkspaceMode = 'desktop' | 'tablet' | 'mobile'

export function getWorkspaceMode(width: number): WorkspaceMode {
  if (width >= 1280) return 'desktop'
  if (width >= 768) return 'tablet'
  return 'mobile'
}

export function useWorkspaceMode(): WorkspaceMode {
  const [mode, setMode] = useState<WorkspaceMode>(() => (
    typeof window === 'undefined' ? 'desktop' : getWorkspaceMode(window.innerWidth)
  ))

  useEffect(() => {
    const handleResize = () => {
      setMode(getWorkspaceMode(window.innerWidth))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return mode
}
