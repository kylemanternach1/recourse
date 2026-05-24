export const UI_PREVIEW_MAX_LINES = 120
export const UI_PREVIEW_MAX_CHARS = 32_000

export function truncateTextPreview(
  text: string | undefined,
  maxLines = UI_PREVIEW_MAX_LINES,
  maxChars = UI_PREVIEW_MAX_CHARS
): { text: string | undefined; truncated: boolean } {
  if (text == null) {
    return { text: undefined, truncated: false }
  }

  let truncated = false
  let lines = text.split('\n')
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    truncated = true
  }

  let result = lines.join('\n')
  if (result.length > maxChars) {
    result = result.slice(0, maxChars)
    truncated = true
  }

  return { text: result, truncated }
}

export function truncateLinesPreview(
  lines: string[],
  maxLines = UI_PREVIEW_MAX_LINES
): { lines: string[]; truncated: boolean } {
  if (lines.length <= maxLines) {
    return { lines, truncated: false }
  }
  return { lines: lines.slice(0, maxLines), truncated: true }
}
