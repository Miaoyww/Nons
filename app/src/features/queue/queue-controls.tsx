import { LocateFixed, Trash2 } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { nativeCall } from '@/lib/player'
import { ActionButton } from '@/components/music/action-button'

export function QueueControls({
  count,
  canLocate,
  onLocate,
  onError
}: {
  count: number
  canLocate: boolean
  onLocate: () => void
  onError: (error: unknown) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ActionButton
        variant="ghost"
        size="sm"
        disabled={!canLocate}
        onClick={onLocate}
        title="定位当前播放"
      >
        <LocateFixed aria-hidden="true" />
        <span>定位当前</span>
      </ActionButton>
      <ActionButton
        variant="ghost"
        size="sm"
        disabled={!count || !isTauri()}
        onClick={() => void nativeCall('player_action', { action: 'clear' }).catch(onError)}
      >
        <Trash2 aria-hidden="true" />
        清空
      </ActionButton>
    </div>
  )
}
