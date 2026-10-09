import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function DetailHeader({ children }: { children: ReactNode }) {
  const header = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = header.current
    const info = element?.querySelector<HTMLElement>('.library-detail-info')
    if (!element || !info) return
    const measure = () =>
      element.style.setProperty('--detail-content-height', `${info.offsetHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(info)
    return () => observer.disconnect()
  }, [])
  return (
    <header ref={header} className="library-detail-header">
      {children}
    </header>
  )
}
