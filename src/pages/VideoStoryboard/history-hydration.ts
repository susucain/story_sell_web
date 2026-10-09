export function shouldApplyHistoryResult(options: {
  requestSessionId: string
  currentSessionId: string
  chatStarted: boolean
  requestAborted: boolean
  disposed: boolean
}): boolean {
  return options.requestSessionId === options.currentSessionId
    && !options.chatStarted
    && !options.requestAborted
    && !options.disposed
}
