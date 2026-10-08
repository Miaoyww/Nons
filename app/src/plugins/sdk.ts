import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { nativeCall, usePlayer as useHostPlayer, useProgress } from '@/lib/player'
import { useTheme as useHostTheme } from '@/features/settings/use-theme'
import { useCoverSource as useHostCoverSource } from '@/components/music/use-cover-source'
import { useMusicNavigation } from '@/features/workspace/music-navigation'
import { checkScope, useScope, type Scope } from './scope'
import { pluginPath, resolvePluginPath } from './types'
export { Button } from '@/components/ui/button'
export type { PluginSong } from './types'
export { SongArtists, SongLikeButton } from './song-components'

export function useSongPlayback() {
  const scope = useScope('player:control')
  return useCallback(
    (id: number, mode: 'now' | 'next') => hostCall<void>(scope, 'player.play-song', { id, mode }),
    [scope]
  )
}

async function hostCall<T>(scope: Scope, operation: string, args: unknown): Promise<T> {
  checkScope(scope)
  const result = await nativeCall<string>('plugin_host_call', {
    id: scope.descriptor.manifest.id,
    generation: scope.descriptor.generation,
    operation,
    args: JSON.stringify(args)
  })
  checkScope(scope)
  return JSON.parse(result) as T
}
export function usePluginBackend() {
  const scope = useScope()
  return useMemo(
    () => ({
      async call<T = unknown>(method: string, args: unknown = null): Promise<T> {
        checkScope(scope)
        const result = await nativeCall<string>('plugin_call', {
          id: scope.descriptor.manifest.id,
          generation: scope.descriptor.generation,
          method,
          args: JSON.stringify(args)
        })
        checkScope(scope)
        return JSON.parse(result) as T
      }
    }),
    [scope]
  )
}
export function usePluginEvent<T = unknown>(event: string): T | undefined {
  const scope = useScope()
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(event)) throw new Error('事件名称无效')
  const subscribe = useCallback(
    (listener: () => void) => {
      scope.listeners.add(listener)
      return () => {
        scope.listeners.delete(listener)
      }
    },
    [scope]
  )
  return useSyncExternalStore(subscribe, () => scope.events.get(event) as T | undefined)
}
export function usePluginStorage() {
  const scope = useScope('storage')
  return useMemo(
    () => ({
      get: <T = unknown>(key: string) => hostCall<T | null>(scope, 'storage.get', { key }),
      set: (key: string, value: unknown) => hostCall<void>(scope, 'storage.set', { key, value }),
      delete: (key: string) => hostCall<void>(scope, 'storage.delete', { key })
    }),
    [scope]
  )
}
export function usePluginNavigate() {
  const scope = useScope('ui')
  const { navigate } = useMusicNavigation()
  return useCallback(
    (path = '/') => {
      checkScope(scope, 'ui')
      navigate('plugin', pluginPath(scope.descriptor.manifest.id, path))
    },
    [scope, navigate]
  )
}
export function usePluginRoute() {
  const scope = useScope('ui')
  const { page } = useMusicNavigation()
  const route = page.view === 'plugin' ? resolvePluginPath(page.query) : undefined
  return route?.pluginId === scope.descriptor.manifest.id
    ? { pathname: route.pathname, search: route.search }
    : { pathname: '/', search: '' }
}
export function usePlayer() {
  const scope = useScope('player:read')
  const state = useHostPlayer()
  const progress = useProgress()
  return useMemo(() => {
    const track = state.index === null ? undefined : state.queue[state.index]
    return {
      status: state.status,
      positionMs: progress.positionMs,
      durationMs: progress.durationMs,
      volume: state.volume,
      track: track
        ? {
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationMs: track.durationMs,
            cover: /^https?:/.test(track.cover) ? track.cover : ''
          }
        : null,
      control: (action: 'pause' | 'resume' | 'next' | 'previous' | 'stop') => {
        checkScope(scope, 'player:control')
        return hostCall<void>(scope, 'player.control', { action })
      }
    }
  }, [state, progress, scope])
}
export function useTheme() {
  useScope('ui')
  const [theme] = useHostTheme()
  return theme
}
export function useCoverSource(cover?: string, enabled = true) {
  useScope('ui')
  return useHostCoverSource(cover, enabled)
}
