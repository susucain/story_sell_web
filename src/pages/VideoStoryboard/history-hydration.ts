export function shouldApplyHistoryResult(options: {
  requestSessionId: string
  currentSessionId: string
  chatStarted: boolean
  disposed: boolean
}): boolean {
  return options.requestSessionId === options.currentSessionId
    && !options.chatStarted
    && !options.disposed
}
