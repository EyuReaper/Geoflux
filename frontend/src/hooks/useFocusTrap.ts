import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(active: boolean): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!active || !ref.current) return

    const container = ref.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    const getFocusableElements = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))

    const focusFirst = () => {
      const els = getFocusableElements()
      if (els.length > 0) els[0].focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const closeButton = container.querySelector<HTMLButtonElement>('[data-close]')
        if (closeButton) {
          closeButton.click()
        }
        return
      }

      if (e.key !== 'Tab') return
      const els = getFocusableElements()
      if (els.length === 0) return

      const first = els[0]
      const last = els[els.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    focusFirst()
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [active])

  return ref
}
