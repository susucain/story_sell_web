import { memo } from 'react'
import { createCodePlugin } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import { Streamdown, type ThemeInput } from 'streamdown'
import 'streamdown/styles.css'
import './style.css'

const shikiTheme: [ThemeInput, ThemeInput] = ['github-light', 'github-dark']

const codePlugin = createCodePlugin({ themes: shikiTheme })
const streamdownPlugins = { mermaid, code: codePlugin }
const streamdownControls = { table: false }

export type StreamdownTextProps = {
  children: string
  /** 助手最后一段文本在流式输出时为 true，用于 Streamdown 动画与未闭合 Markdown */
  isStreaming?: boolean
  /** 将模型用于包裹成品内容的 markdown/md 围栏作为正文渲染 */
  unwrapMarkdownFences?: boolean
}

const markdownFencePattern =
  /(^|\n)[\t ]*```(?:markdown|md)[\t ]*\n([\s\S]*?)\n[\t ]*```(?=\n|$)/gi

function unwrapMarkdownFences(content: string) {
  return content.replace(markdownFencePattern, (_, prefix: string, body: string) => (
    `${prefix}${body}`
  ))
}

function StreamdownTextInner({
  children,
  isStreaming = false,
  unwrapMarkdownFences: shouldUnwrapMarkdownFences = false,
}: StreamdownTextProps) {
  const content = shouldUnwrapMarkdownFences
    ? unwrapMarkdownFences(children)
    : children

  return (
    <div className="chat-streamdown">
      <Streamdown
        mode={isStreaming ? 'streaming' : 'static'}
        isAnimating={isStreaming}
        parseIncompleteMarkdown={isStreaming}
        shikiTheme={shikiTheme}
        plugins={streamdownPlugins}
        controls={streamdownControls}
        className="chat-streamdown__inner"
      >
        {content}
      </Streamdown>
    </div>
  )
}

export const StreamdownText = memo(StreamdownTextInner, (prev, next) => {
  return prev.children === next.children
    && prev.isStreaming === next.isStreaming
    && prev.unwrapMarkdownFences === next.unwrapMarkdownFences
})
