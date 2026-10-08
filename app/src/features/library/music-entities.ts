import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { errorText, nativeCall } from '@/lib/player'
import type { MusicCollection } from '@/features/workspace/music-navigation'

export interface EntityDetail {
  item: MusicCollection
  description?: string | null
  albumCount?: number | null
}

export function useEntityDetail(collection: MusicCollection, refresh: number, enabled = true) {
  const [detail, setDetail] = useState<EntityDetail>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let disposed = false
    setDetail(undefined)
    setError(undefined)
    setBusy(enabled && isTauri())
    if (enabled && isTauri())
      void nativeCall<EntityDetail>('music_entity_detail', {
        kind: collection.kind,
        id: collection.id
      })
        .then((value) => {
          if (!disposed) setDetail(value)
        })
        .catch((cause) => {
          if (!disposed) setError(errorText(cause))
        })
        .finally(() => {
          if (!disposed) setBusy(false)
        })
    return () => {
      disposed = true
    }
  }, [collection.kind, collection.id, refresh, enabled])
  return { detail, error, busy }
}
