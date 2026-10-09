import type { ReactNode } from 'react'
import type { Track } from '@/lib/player'
import { Cover } from './cover'
import { TrackArtists } from './music-links'
import { TrackTitle, trackDisplayTitle } from './track-title'
import {
  useInterfaceDensity,
  type InterfaceDensity
} from '@/features/settings/use-interface-density'

export function TrackIdentity({
  track,
  cover,
  showSource = false,
  mode
}: {
  track: Track
  cover?: ReactNode
  showSource?: boolean
  mode?: InterfaceDensity
}) {
  const [preferredMode] = useInterfaceDensity()
  const displayMode = mode ?? preferredMode
  return (
    <div className="track-identity flex min-w-0 items-center" data-mode={displayMode}>
      {cover ?? <Cover cover={track.cover} className="track-identity-cover" />}
      <div className="min-w-0">
        <p className="track-title truncate font-medium" title={trackDisplayTitle(track)}>
          <TrackTitle track={track} />
        </p>
        <p
          className="track-identity-artist truncate text-xs text-muted-foreground"
          title={track.artist}
        >
          <TrackArtists track={track} />
          {showSource && track.source.kind === 'local' && <span className="ml-2">· 本地</span>}
        </p>
      </div>
    </div>
  )
}
