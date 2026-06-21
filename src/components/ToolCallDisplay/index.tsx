import { useState } from 'react'
import { ToolOutlined, CheckCircleOutlined, LoadingOutlined, RightOutlined, DownOutlined } from '@ant-design/icons'

interface ToolCallDisplayProps {
  part: any
}

export function ToolCallDisplay({ part }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false)
  const toolName = part.type === 'dynamic-tool' ? part.toolName : part.type.replace('tool-', '')
  const state = part.state || 'input-streaming'
  const isStreaming = state === 'input-streaming'
  const isComplete = state === 'output-available' || state === 'error'

  const statusIcon = isStreaming ? (
    <LoadingOutlined style={{ color: '#1677ff', marginRight: 6 }} />
  ) : isComplete ? (
    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
  ) : (
    <RightOutlined style={{ color: '#999', marginRight: 6 }} />
  )

  return (
    <div className="tool-call-display">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        {statusIcon}
        <ToolOutlined style={{ marginRight: 6, color: '#666' }} />
        <span className="tool-call-name">{toolName}</span>
        {expanded ? <DownOutlined style={{ marginLeft: 'auto', fontSize: 12 }} /> : <RightOutlined style={{ marginLeft: 'auto', fontSize: 12 }} />}
      </div>
      {expanded && (
        <div className="tool-call-body">
          {part.input != null && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">输入</div>
              <pre className="tool-call-json">{JSON.stringify(part.input, null, 2)}</pre>
            </div>
          )}
          {part.output != null && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">输出</div>
              <pre className="tool-call-json">{typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)}</pre>
            </div>
          )}
          {part.errorText && (
            <div className="tool-call-section">
              <div className="tool-call-section-label" style={{ color: '#ff4d4f' }}>错误</div>
              <pre className="tool-call-json" style={{ color: '#ff4d4f' }}>{part.errorText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
