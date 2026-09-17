export interface VideoStoryboardRetryRequest {
  sessionId: string
  text: string
  files: Array<{
    type: 'file'
    mediaType: string
    url: string
    filename: string
    purpose: 'all' | 'analysis' | 'reference'
    durationSec?: number
  }>
  body: {
    session_id: string
    referenced_script_id?: number
    source_video_asset_id?: number
  }
}

interface ChatMessageLike {
  role: string
}

interface VideoAgentStreamError {
  code: string
  retryable: boolean
  message: string
}

const RETRYABLE_TIMEOUT_CODES = new Set([
  'MODEL_TIMEOUT',
  'TOOL_TIMEOUT',
  'ASSET_PARSE_TIMEOUT',
  'AGENT_TOTAL_TIMEOUT',
])

export function isRetryForSession(
  request: VideoStoryboardRetryRequest | null,
  sessionId: string,
): request is VideoStoryboardRetryRequest {
  return request?.sessionId === sessionId
}

export function createRetryRequest(request: VideoStoryboardRetryRequest) {
  return {
    text: request.text,
    files: request.files,
    body: {
      ...request.body,
      retry: true,
    },
  }
}

export function discardFailedEphemeralMessages<T extends ChatMessageLike>(
  messages: T[],
): T[] {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')
  return lastUserIndex === -1 ? messages : messages.slice(0, lastUserIndex)
}

export function getVideoAgentErrorAction(
  error: unknown,
): { type: 'retry' | 'refresh'; message: string } | null {
  const parsed = parseVideoAgentStreamError(error)
  if (!parsed) return null
  if (parsed.code === 'OPERATION_STATUS_UNKNOWN') {
    return { type: 'refresh', message: parsed.message }
  }
  if (parsed.retryable && RETRYABLE_TIMEOUT_CODES.has(parsed.code)) {
    return { type: 'retry', message: parsed.message }
  }
  return null
}

function parseVideoAgentStreamError(error: unknown): VideoAgentStreamError | null {
  if (!(error instanceof Error)) return null
  try {
    const parsed = JSON.parse(error.message) as Partial<VideoAgentStreamError>
    return typeof parsed.code === 'string'
      && typeof parsed.retryable === 'boolean'
      && typeof parsed.message === 'string'
      ? parsed as VideoAgentStreamError
      : null
  } catch {
    return null
  }
}
