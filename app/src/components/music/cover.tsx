import { Skeleton } from '@/components/ui/skeleton'
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
  const [readySource, setReadySource] = useState<string>()
  const { source, onError, pending } = useCoverImageSource(cover, visible)
  const loading = pending || (!!source && readySource !== source) || (!!cover && !visible)
  return (
    <div
      ref={host}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${className}`}
    >
      {(loading || !!source) && (
        <Skeleton
          key={`skeleton:${source ?? cover}`}
          data-ready={!loading}
          className={`music-cover-skeleton pointer-events-none absolute inset-0 rounded-[inherit] ${loading ? '' : 'opacity-0'}`}
        />
      )}
      {source ? (
        <img
          key={source}
          src={source}
          alt=""
          loading="lazy"
          data-ready={readySource === source}
          className={`music-cover-image h-full w-full object-cover ${readySource === source ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setReadySource(source)}
          onError={onError}
        />
      ) : !loading ? (
        <Music2 className="size-5 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </div>
  )
}
