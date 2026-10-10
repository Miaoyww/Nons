import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorText } from './player'

export interface ListPage<T, M = undefined> {
  items: T[]
  more: boolean
  metadata?: M
}

// Display state and requests belong to one query. A new query must never expose
// the previous query's rows, even during the render before effects run.
export function usePagedList<T, M = undefined>(
  loader: (offset: number) => Promise<ListPage<T, M>>,
  size: number,
  enabled: boolean
) {
  const query = useMemo(() => ({ loader, size, enabled }), [loader, size, enabled])
  const empty = {
    query,
    items: [] as T[],
    metadata: undefined as M | undefined,
    more: false,
    busy: enabled,
    error: undefined as string | undefined
  }
  const [view, setView] = useState(empty)
  const request = useRef({ query, offset: 0, busy: false, more: true })
  const loadMore = useCallback(async () => {
    const state = request.current
    if (!enabled || state.query !== query || state.busy || !state.more) return
    state.busy = true
    setView((previous) => ({ ...previous, busy: true, error: undefined }))
    try {
      const page = await loader(state.offset)
      if (request.current !== state) return
      const firstPage = state.offset === 0
      setView((previous) => ({
        query,
        items: firstPage ? page.items : [...previous.items, ...page.items],
        metadata: page.metadata,
        more: page.more,
        busy: true,
        error: undefined
      }))
      state.offset += size
      state.more = page.more
    } catch (cause) {
      if (request.current === state)
        setView((previous) => ({ ...previous, error: errorText(cause) }))
    } finally {
      if (request.current === state) {
        state.busy = false
        setView((previous) => ({ ...previous, busy: false }))
      }
    }
  }, [query])
  useEffect(() => {
    request.current = { query, offset: 0, busy: false, more: true }
    setView(empty)
    void loadMore()
    return () => {
      request.current = { ...request.current }
    }
  }, [loadMore])
  const current = view.query === query ? view : empty
  const { items, metadata, more, busy, error } = current
  return { items, metadata, more, busy, error, loadMore }
}
