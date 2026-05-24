export type DiffKind = 'context' | 'add' | 'remove'

export interface DiffRow {
  kind: DiffKind
  text: string
  oldNo?: number
  newNo?: number
}

/** Line-oriented diff for chat previews (old vs new file text). */
export function buildLineDiff(oldText: string, newText: string): DiffRow[] {
  const a = oldText.length === 0 ? [] : oldText.split('\n')
  const b = newText.length === 0 ? [] : newText.split('\n')
  const table = lcsTable(a, b)
  const stack: DiffRow[] = []
  let i = a.length
  let j = b.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ kind: 'context', text: a[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      stack.push({ kind: 'add', text: b[j - 1] })
      j -= 1
    } else {
      stack.push({ kind: 'remove', text: a[i - 1] })
      i -= 1
    }
  }

  stack.reverse()

  let oldNo = 0
  let newNo = 0
  for (const row of stack) {
    if (row.kind === 'context') {
      oldNo += 1
      newNo += 1
      row.oldNo = oldNo
      row.newNo = newNo
    } else if (row.kind === 'remove') {
      oldNo += 1
      row.oldNo = oldNo
    } else {
      newNo += 1
      row.newNo = newNo
    }
  }

  return stack
}

function lcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length + 1
  const cols = b.length + 1
  const table: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0) as number[])

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1])
      }
    }
  }

  return table
}
