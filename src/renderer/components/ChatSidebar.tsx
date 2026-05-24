import type { ConversationListItem } from '../../shared/contracts'
import { groupConversations } from '../lib/chatGroups'

interface ChatSidebarProps {
  conversations: ConversationListItem[]
  activeCaseId?: string
  collapsed: boolean
  isNarrow: boolean
  mobileOpen: boolean
  onNewChat: () => void
  onSelect: (caseId: string) => void
  onToggleCollapse: () => void
  onCloseMobile: () => void
}

export function ChatSidebar({
  conversations,
  activeCaseId,
  collapsed,
  isNarrow,
  mobileOpen,
  onNewChat,
  onSelect,
  onToggleCollapse,
  onCloseMobile
}: ChatSidebarProps): JSX.Element {
  const groups = groupConversations(conversations)
  const isCollapsedDesktop = !isNarrow && collapsed

  const classes = [
    'chat-sidebar',
    isCollapsedDesktop ? 'chat-sidebar--collapsed' : '',
    isNarrow ? 'chat-sidebar--drawer' : '',
    isNarrow && mobileOpen ? 'chat-sidebar--open' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const toggleLabel = isCollapsedDesktop
    ? 'Expand sidebar'
    : isNarrow
      ? 'Close sidebar'
      : 'Collapse sidebar'

  return (
    <>
      {isNarrow && mobileOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close sidebar"
          onClick={onCloseMobile}
        />
      ) : null}
      <aside className={classes} aria-label="Chat history">
        <div className="sidebar-header">
          <div className="sidebar-brand" aria-hidden={isCollapsedDesktop}>
            <span className="brand-mark">R</span>
            <span className="brand-name">Recourse</span>
          </div>
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onToggleCollapse}
            title={toggleLabel}
            aria-label={toggleLabel}
          >
            <PanelIcon />
          </button>
        </div>

        <button
          type="button"
          className="sidebar-new-chat"
          onClick={onNewChat}
          title="New case"
          aria-label="New case"
        >
          <PlusIcon />
          <span className="sidebar-new-chat-label">New case</span>
        </button>

        <nav className="sidebar-chat-list" aria-hidden={isCollapsedDesktop}>
          {conversations.length === 0 ? (
            <p className="sidebar-empty">No cases yet</p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="sidebar-group">
                <p className="sidebar-group-label">{group.label}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.caseId}>
                      <button
                        type="button"
                        className={
                          item.caseId === activeCaseId
                            ? 'sidebar-chat-item active'
                            : 'sidebar-chat-item'
                        }
                        onClick={() => onSelect(item.caseId)}
                        tabIndex={isCollapsedDesktop ? -1 : 0}
                      >
                        <span className="sidebar-chat-title">{item.title}</span>
                        {item.preview ? (
                          <span className="sidebar-chat-preview">{item.preview}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>
      </aside>
    </>
  )
}

function PanelIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2.5 3h3v10h-3V3Zm4 0h7v10h-7V3Z"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
