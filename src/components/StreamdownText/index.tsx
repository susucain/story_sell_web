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
}

function StreamdownTextInner({
  children,
  isStreaming = false,
}: StreamdownTextProps) {
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
        {children}
      </Streamdown>
    </div>
  )
}

export const StreamdownText = memo(StreamdownTextInner, (prev, next) => {
  return prev.children === next.children && prev.isStreaming === next.isStreaming
})
