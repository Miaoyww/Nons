import { ChevronLeft, ChevronRight, Pause, Play, Repeat, Repeat1 } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { formatTime, nativeCall, statusLabels, usePlayer, useProgress } from "@/lib/player";
import { ActionButton } from "./action-button";
import { trackDisplayTitle } from "./track-title";
import { PlaybackNotice, type PlaybackNoticeMessage } from "./playback-notice";
import { QueuePopover } from "./queue-popover";
import { VolumeControl } from "./volume-control";

export function Timeline({ onError }: { onError: (error: unknown) => void }) {
  const progress = useProgress();
  const [drag, setDrag] = useState<number | null>(null);
  return <div className="flex w-full items-center gap-3 text-xs tabular-nums text-muted-foreground">
    <span className="w-10 text-right">{formatTime(drag ?? progress.positionMs)}</span>
    <input type="range" aria-label="播放进度" min={0} max={Math.max(1, progress.durationMs)} step={1000} value={Math.min(drag ?? progress.positionMs, Math.max(1, progress.durationMs))}
      disabled={!isTauri() || !progress.durationMs || ["stopped", "error", "loading"].includes(progress.status)}
      onChange={(event) => setDrag(Number(event.target.value))}
      onPointerUp={(event) => { if (drag !== null) { void nativeCall("player_seek", { positionMs: Number(event.currentTarget.value) }).catch(onError); setDrag(null); } }}
      onPointerCancel={() => setDrag(null)} onBlur={() => setDrag(null)}
      onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key) && drag !== null) { void nativeCall("player_seek", { positionMs: Number(event.currentTarget.value) }).catch(onError); setDrag(null); } }}
      style={{ "--seek-progress": `${100 * Math.min(drag ?? progress.positionMs, Math.max(1, progress.durationMs)) / Math.max(1, progress.durationMs)}%` } as CSSProperties}
      className="music-range min-w-0 flex-1" />
    <span className="w-10">{formatTime(progress.durationMs)}</span>
  </div>;
}

export function PlaybackBar({ onLyrics, onQueue, onError, qualityControl, notice }: { notice?: PlaybackNoticeMessage; qualityControl?: ReactNode; onLyrics: () => void; onQueue: () => void; onError: (error: unknown) => void }) {
  const state = usePlayer();
  const track = state.index !== null ? state.queue[state.index] : undefined;
  const playing = ["playing", "buffering", "loading"].includes(state.status);
  const [preview, setPreview] = useState<"previous" | "next" | null>(null);
  const looping = state.repeatMode === "all" || state.repeatMode === "one";
  const previous = state.index === null ? undefined : state.queue[state.index - 1] ?? (looping ? state.queue[state.queue.length - 1] : undefined);
  const next = state.index === null ? undefined : state.queue[state.index + 1] ?? (looping ? state.queue[0] : undefined);
  const previewTrack = preview === "previous" ? previous : preview === "next" ? next : undefined;
  const title = previewTrack ? trackDisplayTitle(previewTrack) : track ? trackDisplayTitle(track) : "选择一首音乐";
  const action = (action: string) => void nativeCall("player_action", { action }).catch(onError);
  const repeatLabel = state.repeatMode === "one" ? "单曲循环" : state.repeatMode === "all" ? "列表循环" : "顺序播放";
  return <footer className="floating-playback" aria-label="播放控制">
    <PlaybackNotice notice={notice} />
    <div className="playback-capsule">
      <div className="capsule-glass glass-surface" aria-hidden="true" />
      <div className="capsule-main">
        <ActionButton size="icon-lg" className="capsule-play" aria-label={playing ? "暂停" : "播放"} disabled={!track || !isTauri()} onClick={() => action(playing ? "pause" : "resume")}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</ActionButton>
        <div className="capsule-center">
          <div className="capsule-navigation">
            <ActionButton variant="ghost" size="icon-sm" aria-label={previous ? `上一首：${trackDisplayTitle(previous)}` : "上一首"} disabled={!track || !isTauri()} onMouseEnter={() => setPreview("previous")} onMouseLeave={() => setPreview(null)} onFocus={() => setPreview("previous")} onBlur={() => setPreview(null)} onClick={() => action("previous")}><ChevronLeft aria-hidden="true" /></ActionButton>
            <button type="button" className="capsule-title" data-preview={!!previewTrack} aria-label="打开正在播放" title={title} onClick={onLyrics}><span key={title}>{title}</span></button>
            <ActionButton variant="ghost" size="icon-sm" aria-label={next ? `下一首：${trackDisplayTitle(next)}` : "下一首"} disabled={!next || !isTauri()} onMouseEnter={() => setPreview("next")} onMouseLeave={() => setPreview(null)} onFocus={() => setPreview("next")} onBlur={() => setPreview(null)} onClick={() => action("next")}><ChevronRight aria-hidden="true" /></ActionButton>
          </div>
          <Timeline onError={onError} />
        </div>
      </div>
      <div className="capsule-options">
        {qualityControl}
        <ActionButton variant="ghost" size="icon-sm" aria-label={`播放模式：${repeatLabel}，点击切换`} title={repeatLabel} disabled={!isTauri()} data-active={looping} onClick={() => action("repeat")}>{state.repeatMode === "one" ? <Repeat1 aria-hidden="true" /> : <Repeat aria-hidden="true" />}</ActionButton>
        <QueuePopover onPage={onQueue} onError={onError} />
      </div>
      <VolumeControl onError={onError} />
      <span className="sr-only">{statusLabels[state.status]}{state.actualQuality && ` · 实际音质 ${state.actualQuality}`}</span>
    </div>
  </footer>;
}
