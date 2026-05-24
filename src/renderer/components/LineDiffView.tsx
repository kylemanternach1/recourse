import { buildLineDiff, type DiffRow } from '../lib/diffLines'

export function LineDiffView({
  oldText = '',
  newText = ''
}: {
  oldText?: string
  newText?: string
}): JSX.Element | null {
  const rows = buildLineDiff(oldText, newText)
  if (rows.length === 0) {
    return null
  }

  return (
    <pre className="line-diff" aria-label="File changes">
      {rows.map((row, index) => (
        <DiffLine key={`${row.kind}-${index}`} row={row} />
      ))}
    </pre>
  )
}

function DiffLine({ row }: { row: DiffRow }): JSX.Element {
  const prefix =
    row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '
  const lineNo =
    row.kind === 'add'
      ? row.newNo
      : row.kind === 'remove'
        ? row.oldNo
        : row.newNo

  return (
    <div className={`line-diff-row line-diff-row--${row.kind}`}>
      <span className="line-diff-gutter">{lineNo ?? ''}</span>
      <span className="line-diff-prefix" aria-hidden>
        {prefix}
      </span>
      <code className="line-diff-text">{row.text || ' '}</code>
    </div>
  )
}
