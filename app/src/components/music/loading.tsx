import { Skeleton } from '@/components/ui/skeleton'
import { MusicPage } from '@/components/music/music-page'

export function TextSkeleton() {
  return (
    <div role="status" aria-label="正在加载" className="flex w-full flex-col gap-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

export function SongGridSkeleton() {
  return (
    <div className="library-song-grid" role="status" aria-label="正在加载歌曲">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex min-w-0 items-center gap-3 p-2">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CollectionGridSkeleton({
  count = 12,
  artist = false
}: {
  count?: number
  artist?: boolean
}) {
  return (
    <div
      className={artist ? 'library-cover-grid' : 'discover-playlist-grid'}
      role="status"
      aria-label="正在加载收藏"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-2">
          <Skeleton
            className={
              artist ? 'aspect-square w-full rounded-full' : 'aspect-square w-full rounded-xl'
            }
          />
          <Skeleton className="mt-1 h-5 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  )
}

export function TrackListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="正在加载歌曲" className="track-loading">
      <div className="track-loading-head" aria-hidden="true">
        <span>#</span>
        <span>曲目</span>
        <span>专辑</span>
        <span>时长</span>
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="track-loading-row">
          <Skeleton className="h-3 w-4" />
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-8" />
        </div>
      ))}
    </div>
  )
}

export function MusicPageSkeleton({ tracks = false }: { tracks?: boolean }) {
  return (
    <MusicPage>
      <div className="mb-8 flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-9 w-72 max-w-full" />
      </div>
      {tracks ? <TrackListSkeleton /> : <CollectionGridSkeleton />}
    </MusicPage>
  )
}
