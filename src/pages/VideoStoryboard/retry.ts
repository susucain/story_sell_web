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
