import { useSyncExternalStore } from 'react'

export type SongCardMode = 'standard' | 'compact'
const storageKey = 'nons-song-card-mode'
const listeners = new Set<() => void>()
let mode: SongCardMode = 'standard'
function isMode(value: unknown): value is SongCardMode {
  return value === 'standard' || value === 'compact'
}
try {
  const saved = localStorage.getItem(storageKey)
  if (isMode(saved)) mode = saved
} catch {
  /* Storage is optional. */
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function setMode(value: SongCardMode) {
  if (!isMode(value) || value === mode) return
  mode = value
  try {
    localStorage.setItem(storageKey, value)
  } catch {
    /* Keep the current session usable. */
  }
  listeners.forEach((notify) => notify())
}
export function useSongCardMode() {
  return [useSyncExternalStore(subscribe, () => mode), setMode] as const
}
