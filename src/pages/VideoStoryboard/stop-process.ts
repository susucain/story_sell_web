import type { UIMessage } from 'ai'

type MessagePart = UIMessage['parts'][number]

function hasProcessState(message: UIMessage): boolean {
  return message.parts.some((part) => 'type' in part && part.type === 'data-process-state')
}

function hasVisibleAssistantContent(message: UIMessage): boolean {
  if (message.parts.some((part) => (
    part.type === 'text' && part.text.trim()
  ))) return true
  const metadata = message.metadata as { kind?: string } | undefined
  return metadata?.kind === 'video_generation_submitted'
    || metadata?.kind === 'video_generation_result'
}

export function removeStoppedAssistantTurn(messages: UIMessage[]): UIMessage[] {
  const assistantIndex = messages.findLastIndex((message) => message.role === 'assistant')
  if (assistantIndex < 0 || !hasProcessState(messages[assistantIndex])) return messages

  const latestAssistant = messages[assistantIndex]
  if (!hasVisibleAssistantContent(latestAssistant)) {
    return messages.filter((_, index) => index !== assistantIndex)
  }

  return messages.map((message, index) => {
    if (index !== assistantIndex) return message
    return {
      ...message,
      parts: message.parts.filter((part: MessagePart) => (
        !('type' in part) || part.type !== 'data-process-state'
      )),
    }
  })
}
