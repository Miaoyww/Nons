import { Music2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useCoverImageSource } from '@/components/music/use-cover-source'

export function Cover({ cover, className = '' }: { cover?: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!host.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  const { source, onError } = useCoverImageSource(cover, visible)
  return (
    <div
      ref={host}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${className}`}
    >
      {source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={onError}
        />
      ) : (
        <Music2 className="size-5 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  )
}
