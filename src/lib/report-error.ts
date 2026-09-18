export function reportError(context: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[${context}] ${error.message}`, error.stack)
    return
  }

  console.error(`[${context}]`, error)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
