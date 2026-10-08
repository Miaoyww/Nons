import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from './player'

export interface ListPage<T, M = undefined> {
  items: T[]
  more: boolean
  metadata?: M
}

// One request at a time; changing the loader invalidates all previous responses.
export function usePagedList<T, M = undefined>(
  loader: (offset: number) => Promise<ListPage<T, M>>,
  size: number,
  enabled: boolean
) {
  const [items, setItems] = useState<T[]>([])
  const [metadata, setMetadata] = useState<M>()
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef({ offset: 0, busy: false, more: true })
  const loadMore = useCallback(async () => {
    const state = request.current
    if (!enabled || state.busy || !state.more) return
    state.busy = true
    setBusy(true)
    setError(undefined)
    try {
      const page = await loader(state.offset)
      if (request.current !== state) return
      setItems((previous) => (state.offset === 0 ? page.items : [...previous, ...page.items]))
      setMetadata(page.metadata)
      state.offset += size
      state.more = page.more
      setMore(page.more)
    } catch (cause) {
      if (request.current === state) setError(errorText(cause))
    } finally {
      if (request.current === state) {
        state.busy = false
        setBusy(false)
      }
    }
  }, [loader, size, enabled])
  useEffect(() => {
    request.current = { offset: 0, busy: false, more: true }
    setItems([])
    setMetadata(undefined)
    setMore(false)
    setError(undefined)
    setBusy(false)
    void loadMore()
    return () => {
      request.current = { ...request.current }
    }
  }, [loadMore])
  return { items, metadata, more, busy, error, loadMore }
}
