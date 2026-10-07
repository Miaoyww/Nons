import { Popover } from "@base-ui/react/popover";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, ListMusic } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { formatTime, nativeCall, usePlayer, type Track } from "@/lib/player";
import { ActionButton } from "./action-button";
import { Cover } from "./cover";
import { QueueControls } from "./queue-controls";
import { TrackTitle, trackDisplayTitle } from "./track-title";

export const QueueTrackCard = memo(function QueueTrackCard({ track, current, onPlay }: { track: Track; current: boolean; onPlay: () => void }) {
  return <button type="button" className="queue-track-card" data-current={current} aria-current={current ? "true" : undefined} aria-label={`${current ? "当前播放：" : "播放："}${trackDisplayTitle(track)}，${track.artist}`} disabled={!isTauri()} onClick={onPlay}>
    <Cover cover={track.cover} className="size-11 shrink-0 rounded-lg" />
    <span className="min-w-0 flex-1 text-left"><span className="block truncate font-medium" title={trackDisplayTitle(track)}><TrackTitle track={track} /></span><span className="mt-1 block truncate text-sm text-muted-foreground" title={track.artist}>{track.artist}</span></span>
    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatTime(track.durationMs)}</span>
  </button>;
});

function QueueCardList({ onError, onPage }: { onError: (error: unknown) => void; onPage: () => void }) {
  const state = usePlayer();
  const parent = useRef<HTMLDivElement>(null);
  const [locate, setLocate] = useState(0);
  const virtualizer = useVirtualizer({ count: state.queue.length, getScrollElement: () => parent.current, estimateSize: () => 72, overscan: 6 });
  useLayoutEffect(() => {
    if (state.index !== null) virtualizer.scrollToIndex(state.index, { align: "center" });
  }, [locate, virtualizer]);
  return <>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3">
      <Popover.Close className="queue-page-link" aria-label="打开完整播放列表" onClick={onPage}><span className="flex items-center gap-2"><Popover.Title render={<span />} className="text-base font-semibold">播放列表</Popover.Title><ArrowRight className="size-4" aria-hidden="true" /></span><span className="mt-1 block text-xs text-muted-foreground">{state.queue.length} 首歌</span></Popover.Close>
      <QueueControls count={state.queue.length} canLocate={state.index !== null} onLocate={() => setLocate((value) => value + 1)} onError={onError} />
    </header>
    <div ref={parent} className="queue-card-scroll">
      {state.queue.length ? <div role="list" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => <div key={row.index} role="listitem" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: row.size, transform: `translateY(${row.start}px)` }}><QueueTrackCard track={state.queue[row.index]} current={row.index === state.index} onPlay={() => void nativeCall("player_jump", { index: row.index }).catch(onError)} /></div>)}
      </div> : <p className="py-16 text-center text-sm text-muted-foreground">播放列表还是空的</p>}
    </div>
  </>;
}

export function QueuePopover({ onPage, onError }: { onPage: () => void; onError: (error: unknown) => void }) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger render={<ActionButton variant="ghost" size="icon-sm" aria-label="显示播放列表" />}><ListMusic aria-hidden="true" /></Popover.Trigger>
    <Popover.Portal><Popover.Positioner side="top" align="end" sideOffset={16} collisionPadding={16} className="queue-positioner">
      <Popover.Popup className="queue-popover" aria-label="播放列表">
        <QueueCardList onError={onError} onPage={() => { setOpen(false); onPage(); }} />
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
