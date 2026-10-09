import { Input } from '@/components/ui/input'
import { TrackAlbum } from '@/components/music/music-links'
import { useVirtualizer } from '@tanstack/react-virtual'
import { scrollParent } from '@/components/music/infinite-load'
import { Heart, ListPlus, Play, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { errorText, formatTime, type Track } from '@/lib/player'
import { ActionButton } from '@/components/music/action-button'
import { Cover } from '@/components/music/cover'
import { useAccount } from '@/features/account/account'
import { SongContextMenu } from '@/components/music/song-actions'
import { TrackIdentity } from '@/components/music/track-identity'
import type { ReactNode } from 'react'
import { useInterfaceDensity } from '@/features/settings/use-interface-density'

type SortKey = 'default' | 'title' | 'artist' | 'album' | 'duration'

function SortHeader({
  label,
  active,
  descending,
  detail,
  next,
  onClick,
  compact = false
}: {
  label: string
  active: boolean
  descending: boolean
  detail: string
  next: string
  onClick: () => void
  compact?: boolean
}) {
  const Icon = active ? (descending ? ArrowDown : ArrowUp) : ArrowUpDown
  return (
    <button
      type="button"
      className="track-sort-header"
      data-active={active}
      aria-label={`${label}排序：${next}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="track-sort-hint">
        <Icon aria-hidden="true" />
        <span className={compact ? 'sr-only' : undefined}>{detail}</span>
      </span>
    </button>
  )
}

interface Props {
  tracks: Track[]
  currentKey?: string
  busy: boolean
  onPlay: (index: number, tracks: Track[]) => void
  onAppend?: (track: Track) => void
  offset?: number
  currentIndex?: number
  locateRequest?: number
  onRemove?: (track: Track, index: number) => void | Promise<unknown>
  removeLabel?: string
  extraColumns?: {
    label: string
    className?: string
    render: (track: Track, index: number) => ReactNode
  }[]
  sortable?: boolean
  searchable?: boolean
  hasMore?: boolean
  showDuration?: boolean
}

export const TrackList = memo(function TrackList({
  tracks,
  currentKey,
  busy,
  onPlay,
  onAppend,
  offset = 0,
  currentIndex,
  locateRequest,
  onRemove,
  removeLabel,
  extraColumns = [],
  sortable = false,
  searchable = false,
  hasMore = false,
  showDuration = true
}: Props) {
  const [sort, setSort] = useState<SortKey>('default')
  const [descending, setDescending] = useState(false)
  const [query, setQuery] = useState('')
  const sortCycle = (column: 'title' | 'album' | 'duration') => {
    const keys: SortKey[] = column === 'title' ? ['title', 'artist'] : [column]
    const states = [
      { key: 'default' as SortKey, descending: false },
      ...keys.flatMap((key) => [
        { key, descending: false },
        { key, descending: true }
      ])
    ]
    const current = Math.max(
      0,
      states.findIndex((state) => state.key === sort && state.descending === descending)
    )
    return states[(current + 1) % states.length]
  }
  const nextLabel = (column: 'title' | 'album' | 'duration') => {
    const next = sortCycle(column)
    return next.key === 'default'
      ? '恢复默认排序'
      : `${{ title: '标题', artist: '歌手', album: '专辑', duration: '时长' }[next.key]}${next.descending ? '降序' : '升序'}`
  }
  const cycleSort = (column: 'title' | 'album' | 'duration') => {
    const next = sortCycle(column)
    setSort(next.key)
    setDescending(next.descending)
  }
  const ariaSort = (active: boolean) =>
    active ? (descending ? ('descending' as const) : ('ascending' as const)) : undefined
  const titleActive = sort === 'title' || sort === 'artist'
  const entries = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    const result = tracks
      .map((track, index) => ({ track, index }))
      .filter(
        ({ track }) =>
          !searchable ||
          !keyword ||
          [track.title, track.artist, track.album, ...(track.aliases ?? [])].some((value) =>
            value.toLocaleLowerCase().includes(keyword)
          )
      )
    if (sortable && sort !== 'default') {
      const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
      result.sort((a, b) => {
        const compare =
          sort === 'duration'
            ? a.track.durationMs - b.track.durationMs
            : collator.compare(
                a.track[sort as 'title' | 'artist' | 'album'],
                b.track[sort as 'title' | 'artist' | 'album']
              )
        return (descending ? -compare : compare) || a.index - b.index
      })
    }
    return result
  }, [tracks, query, searchable, sortable, sort, descending])
  const visibleTracks = useMemo(() => entries.map(({ track }) => track), [entries])
  const [cardMode] = useInterfaceDensity()
  const { profile, likedIds, likesReady, likesError, pendingLikes, reloadLikes, toggleLike } =
    useAccount()
  const [likeError, setLikeError] = useState<string>()
  const body = useRef<HTMLTableSectionElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => (body.current ? scrollParent(body.current) : null),
    estimateSize: () => (cardMode === 'compact' ? 52 : 72),
    scrollMargin,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height + 4
  })
  useLayoutEffect(() => {
    virtualizer.measure()
    body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-index]').forEach((row) => {
      virtualizer.measureElement(row)
    })
  }, [cardMode, virtualizer])
  useLayoutEffect(() => {
    const element = body.current
    const parent = element && scrollParent(element)
    if (!element || !parent) return
    const measure = () =>
      setScrollMargin(
        element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    observer.observe(element.closest('section') ?? element.closest('table')!)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (locateRequest === undefined || currentIndex === undefined || currentIndex < 0) return
    const visibleIndex = entries.findIndex((entry) => entry.index === currentIndex)
    if (visibleIndex >= 0) virtualizer.scrollToIndex(visibleIndex, { align: 'center' })
  }, [locateRequest, scrollMargin, virtualizer])
  const showLikes = tracks.some((track) => track.source.kind === 'netease')
  const columns =
    3 + Number(showDuration) + extraColumns.length + Number(showLikes) + Number(!!onAppend)
  const rows = virtualizer.getVirtualItems()
  const top = rows.length ? Math.max(0, rows[0].start - scrollMargin) : 0
  const bottom = rows.length
    ? Math.max(0, virtualizer.getTotalSize() - (rows[rows.length - 1].end - scrollMargin))
    : 0
  return (
    <>
      {searchable && (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
          {hasMore && (
            <span className="text-xs text-muted-foreground">
              搜索已加载歌曲，滚动到底部继续加载
            </span>
          )}
          <label className="relative w-64 max-w-full">
            <span className="sr-only">搜索列表歌曲</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
            />
            <Input
              type="search"
              className="pl-9"
              placeholder="搜索歌曲、艺术家、专辑"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      )}
      {searchable && !entries.length && (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          没有匹配的歌曲。
        </p>
      )}
      {(likeError || likesError) && (
        <div role="alert" className="mb-3 flex items-center gap-2 text-sm text-destructive">
          <p>{likeError ?? likesError}</p>
          {likesError && (
            <ActionButton variant="ghost" size="sm" onClick={reloadLikes}>
              重试收藏状态
            </ActionButton>
          )}
        </div>
      )}
      <table className="track-list w-full table-fixed text-left text-sm" data-mode={cardMode}>
        <caption className="sr-only">歌曲列表</caption>
        <thead className="bg-background text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="w-12 py-3 text-center" scope="col">
              序号
            </th>
            <th className="py-3" scope="col" aria-sort={ariaSort(sortable && titleActive)}>
              {sortable ? (
                <SortHeader
                  label="标题"
                  active={titleActive}
                  descending={descending}
                  detail={
                    titleActive
                      ? `${sort === 'artist' ? '歌手' : '标题'}${descending ? '降序' : '升序'}`
                      : '默认排序'
                  }
                  next={nextLabel('title')}
                  onClick={() => cycleSort('title')}
                />
              ) : (
                '歌曲'
              )}
            </th>
            <th
              className="w-[22%] py-3"
              scope="col"
              aria-sort={ariaSort(sortable && sort === 'album')}
            >
              {sortable ? (
                <SortHeader
                  label="专辑"
                  active={sort === 'album'}
                  descending={descending}
                  detail={sort === 'album' ? (descending ? '降序' : '升序') : '默认'}
                  next={nextLabel('album')}
                  onClick={() => cycleSort('album')}
                />
              ) : (
                '专辑'
              )}
            </th>
            {showLikes && (
              <th className="w-12" scope="col">
                <span className="sr-only">喜欢</span>
              </th>
            )}
            {showDuration && (
              <th
                className="w-20 py-3"
                scope="col"
                aria-sort={ariaSort(sortable && sort === 'duration')}
              >
                {sortable ? (
                  <SortHeader
                    compact
                    label="时长"
                    active={sort === 'duration'}
                    descending={descending}
                    detail={sort === 'duration' ? (descending ? '降序' : '升序') : '默认'}
                    next={nextLabel('duration')}
                    onClick={() => cycleSort('duration')}
                  />
                ) : (
                  '时长'
                )}
              </th>
            )}
            {extraColumns.map((column) => (
              <th key={column.label} className={column.className ?? 'w-28 py-3'} scope="col">
                {column.label}
              </th>
            ))}
            {onAppend && (
              <th className="w-12" scope="col">
                <span className="sr-only">加入队列</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody ref={body}>
          {top > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns} style={{ height: top, padding: 0 }} />
            </tr>
          )}
          {rows.map((row) => {
            const { index, track } = entries[row.index]
            return (
              <SongContextMenu
                key={`${track.key}:${index}`}
                track={track}
                onPlay={() => onPlay(row.index, visibleTracks)}
                busy={busy}
                onRemove={onRemove ? () => onRemove(track, index) : undefined}
                removeLabel={removeLabel}
                render={
                  <tr
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    className="track-row group"
                    data-current={
                      currentIndex === undefined ? track.key === currentKey : index === currentIndex
                    }
                    aria-current={
                      (
                        currentIndex === undefined
                          ? track.key === currentKey
                          : index === currentIndex
                      )
                        ? 'true'
                        : undefined
                    }
                  />
                }
              >
                <td className="text-center tabular-nums text-muted-foreground">
                  {offset + row.index + 1}
                </td>
                <td className="track-identity-cell pr-4">
                  <TrackIdentity
                    track={track}
                    mode={cardMode}
                    showSource
                    cover={
                      <button
                        type="button"
                        className="track-cover"
                        disabled={busy}
                        aria-label={`播放 ${track.title}`}
                        onClick={() => onPlay(row.index, visibleTracks)}
                      >
                        <Cover cover={track.cover} className="track-identity-cover" />
                        <span className="track-cover-play">
                          <Play aria-hidden="true" />
                        </span>
                      </button>
                    }
                  />
                </td>
                <td className="truncate pr-4 text-muted-foreground" title={track.album}>
                  <TrackAlbum track={track} />
                </td>
                {showLikes && (
                  <td>
                    {track.source.kind === 'netease' && (
                      <ActionButton
                        variant="ghost"
                        size="icon-sm"
                        className="track-like"
                        data-liked={likedIds.has(track.source.id)}
                        aria-pressed={likedIds.has(track.source.id)}
                        disabled={
                          busy || !profile || !likesReady || pendingLikes.has(track.source.id)
                        }
                        aria-label={`${likedIds.has(track.source.id) ? '取消喜欢' : '喜欢'} ${track.title}`}
                        title={!profile ? '登录后收藏歌曲' : '喜欢 / 取消喜欢'}
                        onClick={() => {
                          if (track.source.kind === 'netease') {
                            setLikeError(undefined)
                            void toggleLike(track.source.id).catch((cause) =>
                              setLikeError(errorText(cause))
                            )
                          }
                        }}
                      >
                        <Heart aria-hidden="true" />
                      </ActionButton>
                    )}
                  </td>
                )}
                {showDuration && (
                  <td className="tabular-nums text-muted-foreground">
                    {formatTime(track.durationMs)}
                  </td>
                )}
                {extraColumns.map((column) => (
                  <td key={column.label} className="tabular-nums text-muted-foreground">
                    {column.render(track, index)}
                  </td>
                ))}
                {onAppend && (
                  <td>
                    <ActionButton
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={`下一首播放 ${track.title}`}
                      title="下一首播放"
                      onClick={() => onAppend(track)}
                    >
                      <ListPlus aria-hidden="true" />
                    </ActionButton>
                  </td>
                )}
              </SongContextMenu>
            )
          })}
          {bottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns} style={{ height: bottom, padding: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
})
