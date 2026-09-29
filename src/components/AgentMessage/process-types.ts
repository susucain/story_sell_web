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
  /** 阶段标识。life-service 为固定三阶段，多 Agent 场景为 `dispatch-<role>` */
  id: string
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
