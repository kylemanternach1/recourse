import { useCallback, useEffect, useState } from 'react'

export function useTimelineDrawer(): {
  open: boolean
  setOpen: (open: boolean) => void
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
} {
  const [open, setOpen] = useState(false)

  const openDrawer = useCallback(() => setOpen(true), [])
  const closeDrawer = useCallback(() => setOpen(false), [])
  const toggleDrawer = useCallback(() => setOpen((value) => !value), [])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return { open, setOpen, openDrawer, closeDrawer, toggleDrawer }
}
