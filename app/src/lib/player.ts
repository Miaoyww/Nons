import { invoke, isTauri, convertFileSrc } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSyncExternalStore } from 'react'
import {
  cachedCommands,
  coverCache,
  invalidateNativeCache,
  requestCache,
  requestKey
} from '@/lib/runtime-cache'

export type TrackSource =
  { kind: 'netease'; id: number } | { kind: 'local'; path: string; neteaseId: number | null }
export interface MusicCredit {
  name: string
  id?: number | null
}
export interface Track {
  key: string
  title: string
  aliases?: string[]
  artist: string
  album: string
  artists?: MusicCredit[]
  albumId?: number | null
  durationMs: number
  cover: string
  source: TrackSource
}
export type PlaybackStatus = 'stopped' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error'
export interface PlayerSnapshot {
  shuffle: boolean
  shuffleOrder: number[]
  repeatMode: 'off' | 'all' | 'one'
  revision: number
  queue: Track[]
  index: number | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  deviceId: string | null
  actualQuality: string | null
  error: string | null
  mediaError: string | null
}
export interface Progress {
  revision: number
  positionMs: number
  durationMs: number
  status: PlaybackStatus
  receivedAt: number
}
export interface Lyrics {
  source: 'amll' | 'qq' | 'netease' | 'local'
  format: 'ttml' | 'yrc' | 'qrc' | 'lrc'
  content: string
  translation: string | null
  romanization: string | null
}
export interface OutputDevice {
  id: string
  name: string
}

let snapshot: PlayerSnapshot = {
  shuffle: false,
  shuffleOrder: [],
  repeatMode: 'off',
  revision: 0,
  queue: [],
  index: null,
  status: 'stopped',
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  deviceId: null,
  actualQuality: null,
  error: null,
  mediaError: null
}
let progress: Progress = {
  revision: 0,
  positionMs: 0,
  durationMs: 0,
  status: 'stopped',
  receivedAt: 0
}
let updateSerial = 0
const stateListeners = new Set<() => void>()
const progressListeners = new Set<() => void>()
const subscribeState = (listener: () => void) => {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}
const subscribeProgress = (listener: () => void) => {
  progressListeners.add(listener)
  return () => {
    progressListeners.delete(listener)
  }
}
export const usePlayer = () => useSyncExternalStore(subscribeState, () => snapshot)
const subscribeNothing = (_listener: () => void) => () => {}
export const useProgress = (enabled = true) =>
  useSyncExternalStore(enabled ? subscribeProgress : subscribeNothing, () => progress)
export const getPlayer = () => snapshot
export const getProgress = () => progress

export function adjacentIndex(
  state: PlayerSnapshot,
  direction: 'previous' | 'next'
): number | null {
  if (state.index === null || !state.queue[state.index]) return null
  const order = state.shuffle ? state.shuffleOrder : null
  const slot = order ? order.indexOf(state.index) : state.index
  if (slot < 0) return null
  const count = order ? order.length : state.queue.length
  let target = slot + (direction === 'next' ? 1 : -1)
  if (target < 0 || target >= count) {
    if (!state.shuffle && state.repeatMode === 'off') return null
    target = (target + count) % count
  }
  return order ? order[target] : target
}

function updateProgress(value: Omit<Progress, 'receivedAt'>) {
  if (value.revision !== snapshot.revision) return
  progress = { ...value, receivedAt: performance.now() }
  progressListeners.forEach((notify) => notify())
}

function updateState(value: PlayerSnapshot) {
  if (value.revision < snapshot.revision) return
  snapshot = value
  updateSerial++
  updateProgress(value)
  stateListeners.forEach((notify) => notify())
}

export async function nativeCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('请在 NonsPlayer 桌面应用中使用此功能。')
  if (command === 'runtime_cover')
    return coverCache.get(requestKey(command, args), () => invoke<T>(command, args))
  if (cachedCommands.has(command)) {
    const key = requestKey(command, args)
    if (args?.refresh) requestCache.delete(key)
    const value = await requestCache.get<T>(key, async () => {
      const result = await invoke<T>(command, args)
      // Partial previews and transient absent lyrics must remain retryable.
      if (command === 'music_library' && (result as { likedError?: string })?.likedError) {
        throw new Error((result as { likedError: string }).likedError)
      }
      return result
    })
    if (command === 'track_lyrics' && value === null) requestCache.delete(key)
    return value
  }
  const result = await invoke<T>(command, args)
  const affected: Record<string, string[]> = {
    discovery_dislike: ['discovery_tracks'],
    set_song_liked: ['liked_song_ids', 'music_library', 'library_tracks', 'library_collections'],
    remove_playlist_song: [
      'liked_song_ids',
      'music_library',
      'library_tracks',
      'library_collections'
    ],
    add_playlist_song: ['liked_song_ids', 'music_library', 'library_tracks', 'library_collections'],
    update_library_playlist: [
      'music_library',
      'library_tracks',
      'library_collections',
      'discovery_playlists',
      'music_entity_detail'
    ],
    delete_library_playlist: [
      'music_library',
      'library_tracks',
      'library_collections',
      'discovery_playlists'
    ],
    create_library_playlist: ['library_collections', 'music_library'],
    import_music: [
      'local_music',
      'local_entities',
      'local_entity_detail',
      'local_entity_tracks',
      'local_track_information'
    ],
    add_music_folder: [
      'local_music',
      'local_entities',
      'local_entity_detail',
      'local_entity_tracks',
      'local_track_information'
    ],
    remove_music_folder: [
      'local_music',
      'local_entities',
      'local_entity_detail',
      'local_entity_tracks',
      'local_track_information'
    ],
    rescan_music_folders: [
      'local_music',
      'local_entities',
      'local_entity_detail',
      'local_entity_tracks',
      'local_track_information'
    ],
    bind_local_lyrics: ['track_lyrics', 'local_music'],
    set_lyric_endpoints: ['track_lyrics'],
    set_lyric_sources: ['track_lyrics'],
    set_local_preferences: [
      'track_lyrics',
      'local_entities',
      'local_entity_detail',
      'local_entity_tracks'
    ],
    create_local_playlist: ['local_entities', 'local_entity_detail'],
    rename_local_playlist: ['local_entities', 'local_entity_detail'],
    delete_local_playlist: ['local_entities', 'local_entity_detail', 'local_entity_tracks'],
    add_local_playlist_track: ['local_entities', 'local_entity_detail', 'local_entity_tracks'],
    remove_local_playlist_track: ['local_entities', 'local_entity_detail', 'local_entity_tracks'],
    clear_local_cache: ['track_lyrics'],
    set_local_cache_options: ['track_lyrics'],
    logout: [...cachedCommands]
  }
  if (affected[command]) invalidateNativeCache(affected[command])
  return result
}

export async function connectPlayer(): Promise<UnlistenFn> {
  if (!isTauri()) return () => {}
  const listeners: UnlistenFn[] = []
  try {
    listeners.push(
      await listen<PlayerSnapshot>('player-state', ({ payload }) => updateState(payload))
    )
    listeners.push(
      await listen<Omit<Progress, 'receivedAt'>>('player-progress', ({ payload }) =>
        updateProgress(payload)
      )
    )
    listeners.push(await listen('lyrics-updated', () => invalidateNativeCache(['track_lyrics'])))
    const serial = updateSerial
    const initial = await nativeCall<PlayerSnapshot>('player_snapshot')
    if (serial === updateSerial) updateState(initial)
    return () => listeners.forEach((unlisten) => unlisten())
  } catch (error) {
    listeners.forEach((unlisten) => unlisten())
    throw error
  }
}

export function currentPosition(now = performance.now()): number {
  const advance =
    progress.status === 'playing' ? Math.min(500, Math.max(0, now - progress.receivedAt)) : 0
  return Math.round(
    Math.min(progress.durationMs || Number.MAX_SAFE_INTEGER, progress.positionMs + advance)
  )
}

export function coverSource(cover: string): string | undefined {
  if (!cover) return undefined
  if (cover.startsWith('https://') || cover.startsWith('http://')) return cover
  return isTauri() ? convertFileSrc(cover) : undefined
}

export function formatTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const statusLabels: Record<PlaybackStatus, string> = {
  stopped: '已停止',
  loading: '正在加载',
  playing: '正在播放',
  paused: '已暂停',
  buffering: '正在缓冲',
  error: '播放失败'
}
