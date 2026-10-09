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
export function useNetease(): {
  getSong(id: number): Promise<PluginSong>
  playSong(id: number, mode: 'now' | 'next'): Promise<void>
}
export function usePluginClipboard(): {
  readText(): Promise<string>
  subscribe(callback: (text: string) => void): Promise<() => void>
}
export interface PluginHttpRequest {
  url: string
  method?: 'GET' | 'HEAD' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  responseType?: 'text' | 'none'
}
export interface PluginHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
  cookies?: string[]
}
export function usePluginHttp(): {
  request(request: PluginHttpRequest): Promise<PluginHttpResponse>
}
export const SongArtists: ComponentType<{ song: PluginSong }>
export const SongLikeButton: ComponentType<{ song: PluginSong; onError: (error: unknown) => void }>
export function usePluginStorage(): {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}
export interface ConfigSnapshot {
  values: Record<string, unknown>
  revision: number
  diagnostics: Record<string, string>
  pendingReload: boolean
}
export function usePluginConfig(): {
  getSnapshot(): Promise<ConfigSnapshot>
  update(patch: Record<string, unknown>, revision: number): Promise<ConfigSnapshot>
  reset(revision: number, keys?: string[]): Promise<ConfigSnapshot>
  subscribe(callback: (snapshot: ConfigSnapshot) => void): Promise<() => void>
}
export interface PluginFile {
  read(offset: number, length?: number): Promise<Uint8Array>
  write(offset: number, bytes: Uint8Array): Promise<{ bytes: number }>
  truncate(length: number): Promise<void>
  close(): Promise<void>
}
export function usePluginFiles(): {
  roots(): Promise<{ id: string; writable: boolean }[]>
  stat(root: string, path?: string): Promise<{ isDirectory: boolean; size: number }>
  list(
    root: string,
    path?: string,
    offset?: number
  ): Promise<{
    entries: { name: string; isDirectory: boolean; isLink: boolean }[]
    nextOffset: number | null
  }>
  mkdir(root: string, path: string): Promise<void>
  rename(root: string, path: string, to: string): Promise<void>
  publish(root: string, path: string, to: string): Promise<void>
  remove(root: string, path: string): Promise<void>
  open(root: string, path: string, mode?: 'read' | 'readWrite' | 'create'): Promise<PluginFile>
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

export const Progress: ComponentType<{
  value: number | null
  min?: number
  max?: number
  className?: string
  'aria-label'?: string
  'aria-valuetext'?: string
}>

/** Passed to activate(client) and song menu handlers; bound to this plugin generation. */
export interface PluginClient {
  call<T = unknown>(operation: string, args?: unknown): Promise<T>
  openPage(path?: string): void
  openConfiguration(): void
}
export interface PluginMenuSong {
  key: string
  title: string
  artist: string
  album: string
  durationMs: number
  cover: string
  source: { kind: 'netease'; id: number } | { kind: 'local' }
}
export interface PluginTransfer {
  id: number
  state: 'running' | 'completed' | 'cancelled' | 'failed'
  bytes: number
  total: number | null
  error: string | null
}
