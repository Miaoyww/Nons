import { useEffect, useState } from 'react'
import { AppWindow, LogOut, Settings } from 'lucide-react'
import { TrackIdentity } from '@/components/music/track-identity'
import { Cover } from '@/components/music/cover'
import { Button } from '@/components/ui/button'
import { PlaybackTransport } from '@/features/playback/playback-transport'
import { useTheme } from '@/features/settings/use-theme'
import { connectPlayer, errorText, nativeCall, statusLabels, usePlayer } from '@/lib/player'

export default function TrayMenu() {
  useTheme()
  const state = usePlayer()
  const track = state.index === null ? undefined : state.queue[state.index]
  const [error, setError] = useState<string>()
  const onError = (cause: unknown) => setError(errorText(cause))
  const action = (action: string) => void nativeCall('tray_action', { action }).catch(onError)

  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    void connectPlayer({ observer: true })
      .then((cleanup) => {
        if (disposed) cleanup()
        else stop = cleanup
      })
      .catch((cause) => {
        if (!disposed) setError(errorText(cause))
      })
    return () => {
      disposed = true
      stop?.()
    }
  }, [])

  return (
    <main
      aria-label="托盘菜单"
      className="flex h-dvh flex-col gap-2 overflow-auto border border-border bg-popover p-3 text-popover-foreground"
      onKeyDown={(event) => {
        if (event.key === 'Escape') action('dismiss')
      }}
    >
      <section aria-label="正在播放" className="rounded-lg bg-muted/50 p-3">
        {track ? (
          <TrackIdentity track={track} mode="compact" interactive={false} />
        ) : (
          <div className="flex items-center gap-3">
            <Cover className="size-11" />
            <div>
              <p className="text-sm font-medium">暂无正在播放的音乐</p>
              <p className="text-xs text-muted-foreground">NonsPlayer</p>
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{statusLabels[state.status]}</p>
      </section>
      <PlaybackTransport onError={onError} />
      <div className="border-t border-border" role="separator" />
      <nav aria-label="应用操作" className="flex flex-col gap-1">
        <Button autoFocus variant="ghost" className="justify-start" onClick={() => action('open')}>
          <AppWindow aria-hidden="true" />
          打开
        </Button>
        <Button variant="ghost" className="justify-start" onClick={() => action('settings')}>
          <Settings aria-hidden="true" />
          设置
        </Button>
        <Button variant="ghost" className="justify-start" onClick={() => action('exit')}>
          <LogOut aria-hidden="true" />
          退出
        </Button>
      </nav>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </main>
  )
}
