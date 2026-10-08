import { ListMusic, Volume1, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { nativeCall, usePlayer } from '@/lib/player'
import { ActionButton } from '@/components/music/action-button'
import { QualitySelect } from '@/features/playback/music-options'
import { PlaybackTimeline } from '@/features/playback/playback-timeline'
import { PlayerSlider } from '@/features/playback/player-slider'
import { PlaybackTransport } from '@/features/playback/playback-transport'

export function NowPlayingControls({
  onQueue,
  onError
}: {
  onQueue: () => void
  onError: (error: unknown) => void
}) {
  const state = usePlayer()
  const [volume, setVolume] = useState(state.volume)
  useEffect(() => setVolume(state.volume), [state.volume])
  return (
    <div className="now-playing-controls flex shrink-0 flex-col" aria-label="正在播放控制">
      <PlaybackTimeline layout="below" onError={onError} />
      <PlaybackTransport onError={onError} />
      <div className="flex items-center gap-3">
        <Volume1 className="size-4 shrink-0" aria-hidden="true" />
        <PlayerSlider
          className="min-w-0 flex-1"
          aria-label="音量"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          disabled={!isTauri()}
          onChange={(event) => {
            const value = Number(event.target.value)
            setVolume(value)
            void nativeCall('player_volume', { volume: value }).catch(onError)
          }}
        />
        <Volume2 className="size-5 shrink-0" aria-hidden="true" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <QualitySelect />
        <ActionButton variant="ghost" size="icon" aria-label="显示播放队列" onClick={onQueue}>
          <ListMusic aria-hidden="true" />
        </ActionButton>
      </div>
    </div>
  )
}
