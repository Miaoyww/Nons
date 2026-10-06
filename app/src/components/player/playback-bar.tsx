import { ListMusic, Mic2, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { formatTime, nativeCall, statusLabels, usePlayer, useProgress } from "@/lib/player";
import { ActionButton } from "./action-button";
import { Cover } from "./cover";

function Timeline({ onError }: { onError: (error: unknown) => void }) {
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
      className="music-range min-w-0 flex-1" />
    <span className="w-10">{formatTime(progress.durationMs)}</span>
  </div>;
}

export function PlaybackBar({ onLyrics, onQueue, onError }: { onLyrics: () => void; onQueue: () => void; onError: (error: unknown) => void }) {
  const state = usePlayer();
  const track = state.index !== null ? state.queue[state.index] : undefined;
  const playing = state.status === "playing" || state.status === "buffering" || state.status === "loading";
  const [volume, setVolume] = useState(state.volume);
  useEffect(() => setVolume(state.volume), [state.volume]);
  const action = (action: string) => void nativeCall("player_action", { action }).catch(onError);
  return <footer className="grid h-28 shrink-0 grid-cols-[minmax(180px,1fr)_minmax(280px,1.4fr)_minmax(180px,1fr)] items-center gap-6 border-t border-border bg-background px-6" aria-label="播放控制">
    <div className="flex min-w-0 items-center gap-3"><Cover cover={track?.cover} className="size-14" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{track?.title ?? "选择一首音乐"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{track?.artist ?? "网易云音乐与本地曲库"}</p><p className="mt-1 text-xs text-muted-foreground">{statusLabels[state.status]}{state.actualQuality && ` · ${state.actualQuality}`}</p></div></div>
    <div className="flex flex-col items-center gap-3"><div className="flex items-center gap-5">
      <ActionButton variant="ghost" size="icon" aria-label="上一首" disabled={!track || !isTauri()} onClick={() => action("previous")}><SkipBack aria-hidden="true" /></ActionButton>
      <ActionButton size="icon-lg" className="rounded-full" aria-label={playing ? "暂停" : "播放"} disabled={!track || !isTauri()} onClick={() => action(playing ? "pause" : "resume")}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</ActionButton>
      <ActionButton variant="ghost" size="icon" aria-label="下一首" disabled={state.index === null || state.index + 1 >= state.queue.length || !isTauri()} onClick={() => action("next")}><SkipForward aria-hidden="true" /></ActionButton>
    </div><Timeline onError={onError} /></div>
    <div className="flex items-center justify-end gap-3">
      <ActionButton variant="ghost" size="icon" aria-label="显示歌词" onClick={onLyrics}><Mic2 aria-hidden="true" /></ActionButton>
      <ActionButton variant="ghost" size="icon" aria-label="显示播放队列" onClick={onQueue}><ListMusic aria-hidden="true" /></ActionButton>
      <Volume2 className="size-4 text-muted-foreground" aria-hidden="true" />
      <input type="range" aria-label="音量" min={0} max={1} step={0.01} value={volume} disabled={!isTauri()} onChange={(e) => setVolume(Number(e.target.value))}
        onPointerUp={(event) => void nativeCall("player_volume", { volume: Number(event.currentTarget.value) }).catch(onError)}
        onKeyUp={(event) => void nativeCall("player_volume", { volume: Number(event.currentTarget.value) }).catch(onError)} className="music-range w-20" />
    </div>
  </footer>;
}
