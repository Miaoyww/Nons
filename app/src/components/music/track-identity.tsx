import type { ReactNode } from 'react'
import type { Track } from '@/lib/player'
import { Cover } from './cover'
import { TrackArtists } from './music-links'
import { TrackTitle, trackDisplayTitle } from './track-title'

export function TrackIdentity({
  track,
  cover,
  showSource = false
}: {
  track: Track
  cover?: ReactNode
  showSource?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {cover ?? <Cover cover={track.cover} className="size-11" />}
      <div className="min-w-0">
        <p className="track-title truncate font-medium" title={trackDisplayTitle(track)}>
          <TrackTitle track={track} />
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={track.artist}>
          <TrackArtists track={track} />
          {showSource && track.source.kind === 'local' && <span className="ml-2">· 本地</span>}
        </p>
      </div>
    </div>
  )
}
