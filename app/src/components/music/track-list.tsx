import { TrackAlbum } from '@/components/music/music-links'
import { useVirtualizer } from '@tanstack/react-virtual'
import { scrollParent } from '@/components/music/infinite-load'
import { Heart, ListPlus, Play } from 'lucide-react'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { errorText, formatTime, type Track } from '@/lib/player'
import { ActionButton } from '@/components/music/action-button'
import { Cover } from '@/components/music/cover'
import { useAccount } from '@/features/account/account'
import { SongContextMenu } from '@/components/music/song-actions'
import { TrackIdentity } from '@/components/music/track-identity'
import type { ReactNode } from 'react'
import { useSongCardMode } from '@/features/settings/use-song-card-mode'

interface Props {
  tracks: Track[]
  currentKey?: string
  busy: boolean
  onPlay: (index: number) => void
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
  showDuration = true
}: Props) {
  const [cardMode] = useSongCardMode()
  const { profile, likedIds, likesReady, likesError, pendingLikes, reloadLikes, toggleLike } =
    useAccount()
  const [likeError, setLikeError] = useState<string>()
  const body = useRef<HTMLTableSectionElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const virtualizer = useVirtualizer({
    count: tracks.length,
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
    virtualizer.scrollToIndex(currentIndex, { align: 'center' })
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
            <th className="py-3" scope="col">
              歌曲
            </th>
            <th className="w-[22%] py-3" scope="col">
              专辑
            </th>
            {showLikes && (
              <th className="w-12" scope="col">
                <span className="sr-only">喜欢</span>
              </th>
            )}
            {showDuration && (
              <th className="w-20 py-3" scope="col">
                时长
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
            const index = row.index
            const track = tracks[index]
            return (
              <SongContextMenu
                key={`${track.key}:${index}`}
                track={track}
                onPlay={() => onPlay(index)}
                busy={busy}
                onRemove={onRemove ? () => onRemove(track, index) : undefined}
                removeLabel={removeLabel}
                render={
                  <tr
                    ref={virtualizer.measureElement}
                    data-index={index}
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
                  {offset + index + 1}
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
                        onClick={() => onPlay(index)}
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
