import type { Track } from '@/lib/player'
import type { PluginManifest } from './types'

export function songMenuContributions(manifest: PluginManifest, track: Track) {
  return (manifest.contributes.contextMenus ?? []).filter(
    (menu) => menu.target === 'song' && menu.source === track.source.kind
  )
}
export function publicMenuSong(track: Track) {
  return {
    key: track.key,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    cover: track.cover.startsWith('http') ? track.cover : '',
    source:
      track.source.kind === 'netease'
        ? { kind: 'netease' as const, id: track.source.id }
        : { kind: 'local' as const }
  }
}
