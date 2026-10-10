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
      {loading && <Skeleton className="absolute inset-0 rounded-[inherit]" />}
      {source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${readySource === source ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setReadySource(source)}
          onError={onError}
        />
      ) : !loading ? (
        <Music2 className="size-5 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </div>
  )
}
