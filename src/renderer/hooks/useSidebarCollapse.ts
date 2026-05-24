import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'recourse.sidebarCollapsed'
const NARROW_BREAKPOINT = 768

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'true') {
    return true
  }
  if (stored === 'false') {
    return false
  }
  return window.innerWidth < NARROW_BREAKPOINT
}

export function useSidebarCollapse(): {
  collapsed: boolean
  isNarrow: boolean
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  toggle: () => void
  expand: () => void
  collapse: () => void
} {
  const [collapsed, setCollapsed] = useState(readInitialCollapsed)
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onResize = (): void => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persist = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
  }, [])

  const toggle = useCallback(() => {
    if (isNarrow) {
      setMobileOpen((current) => !current)
      return
    }
    setCollapsed((current) => {
      const next = !current
      persist(next)
      return next
    })
  }, [isNarrow, persist])

  const expand = useCallback(() => {
    if (isNarrow) {
      setMobileOpen(true)
      return
    }
    setCollapsed(false)
    persist(false)
  }, [isNarrow, persist])

  const collapse = useCallback(() => {
    if (isNarrow) {
      setMobileOpen(false)
      return
    }
    setCollapsed(true)
    persist(true)
  }, [isNarrow, persist])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  const effectiveCollapsed = isNarrow ? !mobileOpen : collapsed

  return {
    collapsed: effectiveCollapsed,
    isNarrow,
    mobileOpen,
    setMobileOpen,
    toggle,
    expand,
    collapse
  }
}
