export type ProcessStatus = 'pending' | 'running' | 'waiting_for_user' | 'completed' | 'error' | 'skipped'

export interface ProcessItem {
  id: string
  title: string
  description?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  tag?: { text: string; type: 'success' | 'info' }
  meta?: Record<string, string | number | undefined>
}

export interface ProcessCard {
  id: string
  icon: string
  iconColor: string
  iconBg: string
  title: string
  description: string
}

export interface ProcessAction {
  id: string
  title: string
  description?: string
  status: 'pending' | 'running' | 'waiting_for_user' | 'completed' | 'error'
}

export interface ProcessOutput {
  title: string
  tags: string[]
}

export interface ProcessPhase {
  id: 'parse-materials' | 'load-guidelines' | 'generate-script'
  title: string
  description: string
  status: ProcessStatus
  startTime?: number
  endTime?: number
  items?: ProcessItem[]
  cards?: ProcessCard[]
  actions?: ProcessAction[]
  outputs?: ProcessOutput[]
}

export interface ProcessState {
  status: ProcessStatus
  startTime?: number
  endTime?: number
  phases: ProcessPhase[]
}

export interface ProcessStatePart {
  type: 'data-process-state'
  data: ProcessState
}
