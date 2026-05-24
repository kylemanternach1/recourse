import type { ConversationListItem } from '../../shared/contracts'

export interface ConversationGroup {
  label: string
  items: ConversationListItem[]
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function groupLabel(updatedAt: string, now: Date): string {
  const date = new Date(updatedAt)
  const today = startOfDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const day = startOfDay(date)
  if (day.getTime() === today.getTime()) {
    return 'Today'
  }
  if (day.getTime() === yesterday.getTime()) {
    return 'Yesterday'
  }
  if (day.getTime() >= weekAgo.getTime()) {
    return 'Previous 7 days'
  }
  return 'Older'
}

export function groupConversations(items: ConversationListItem[]): ConversationGroup[] {
  const now = new Date()
  const buckets = new Map<string, ConversationListItem[]>()
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Older']

  for (const item of items) {
    const label = groupLabel(item.updatedAt, now)
    const list = buckets.get(label) ?? []
    list.push(item)
    buckets.set(label, list)
  }

  const groups: ConversationGroup[] = []
  for (const label of order) {
    const groupItems = buckets.get(label)
    if (groupItems && groupItems.length > 0) {
      groups.push({ label, items: groupItems })
    }
  }
  return groups
}
