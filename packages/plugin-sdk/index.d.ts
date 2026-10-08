import type { ComponentType, ReactNode } from 'react'
export interface PluginSong {
  id: number
  key: string
  title: string
  artist: string
  artists?: { id?: number | null; name: string }[]
  album: string
  durationMs: number
  cover: string
}
export function usePluginBackend(): {
  call<T = unknown>(method: string, args?: unknown): Promise<T>
}
export function usePluginEvent<T = unknown>(event: string): T | undefined
export function useSongPlayback(): (id: number, mode: 'now' | 'next') => Promise<void>
export const SongArtists: ComponentType<{ song: PluginSong }>
export const SongLikeButton: ComponentType<{ song: PluginSong; onError: (error: unknown) => void }>
export function usePluginStorage(): {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}
export function usePluginNavigate(): (path?: string) => void
export function usePluginRoute(): { pathname: string; search: string }
export function useTheme(): 'light' | 'dark' | 'system'
export function useCoverSource(cover?: string, enabled?: boolean): string | undefined
export function usePlayer(): {
  status: string
  positionMs: number
  durationMs: number
  volume: number
  track: Omit<PluginSong, 'id' | 'key'> | null
  control(action: 'pause' | 'resume' | 'next' | 'previous' | 'stop'): Promise<void>
}
export const Button: ComponentType<{
  children?: ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm'
  'aria-label'?: string
}>
