import { Skeleton } from '@/components/ui/skeleton'

export function LyricLoading() {
  return (
    <div className="lyric-loading" role="status" aria-label="正在加载歌词">
      {[72, 94, 80, 64, 88].map((width, index) => (
        <Skeleton key={index} className="h-7 rounded-lg" style={{ width: `${width}%` }} />
      ))}
    </div>
  )
}
