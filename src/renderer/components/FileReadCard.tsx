import type { FileReadRecord } from '../../shared/contracts'

export function FileReadCard({ read }: { read: FileReadRecord }): JSX.Element {
  const lineCount = read.endLine - read.startLine + 1

  return (
    <>
      <div className="msg-avatar file-tool-avatar" aria-hidden>
        ↓
      </div>
      <div className="file-tool-card">
        <p className="file-tool-label">Read file</p>
        <p className="file-tool-path" title={read.path}>
          {read.path}
        </p>
        <p className="file-tool-meta">
          Lines {read.startLine}–{read.endLine}
          {read.totalLines > 0 ? ` of ${read.totalLines}` : ''}
          {read.truncated ? ' · preview truncated' : ''}
        </p>
        {read.lines.length > 0 ? (
          <pre className="file-read-preview" aria-label={`${lineCount} lines`}>
            {read.lines.map((line, index) => (
              <div key={read.startLine + index} className="file-read-line">
                <span className="file-read-gutter">{read.startLine + index}</span>
                <code className="file-read-text">{line || ' '}</code>
              </div>
            ))}
          </pre>
        ) : read.startLine > 0 && read.endLine >= read.startLine ? (
          <p className="file-tool-empty">Line preview wasn&apos;t stored for this read.</p>
        ) : (
          <p className="file-tool-empty">Empty range.</p>
        )}
      </div>
    </>
  )
}
