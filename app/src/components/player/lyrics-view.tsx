import { LyricPlayer, type LyricPlayerRef } from "@applemusic-like-lyrics/react";
import { parseLrc, parseTTML, parseYrc, type LyricLine } from "@applemusic-like-lyrics/lyric";
import "@applemusic-like-lyrics/core/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { useReducedMotion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { currentPosition, errorText, nativeCall, usePlayer, useProgress, type Lyrics } from "@/lib/player";
import { ActionButton } from "./action-button";
import { Cover } from "./cover";
import { AlbumBackground } from "./album-background";
import { NowPlayingControls } from "./now-playing-controls";

function parseLyrics(value: Lyrics, duration: number): LyricLine[] {
  const result = value.format === "ttml" ? parseTTML(value.content).lines : value.format === "yrc" ? parseYrc(value.content) : parseLrc(value.content);
  const translations = value.translation ? new Map(parseLrc(value.translation).map((line) => [line.startTime, line.words.map((word) => word.word).join("")])) : undefined;
  const romans = value.romanization ? new Map(parseLrc(value.romanization).map((line) => [line.startTime, line.words.map((word) => word.word).join("")])) : undefined;
  if (!result.length) throw new Error("歌词没有可显示的时间轴。");
  return result.map((line, index) => {
    const end = Number.isFinite(line.endTime) && line.endTime > line.startTime ? line.endTime : result[index + 1]?.startTime ?? Math.max(duration, line.startTime + 5000);
    if (!Number.isFinite(line.startTime) || line.startTime < 0 || end < line.startTime) throw new Error("歌词时间轴无效。");
    return { ...line, endTime: end, words: line.words.map((word) => ({ ...word, endTime: Number.isFinite(word.endTime) && word.endTime > word.startTime ? word.endTime : end })),
      translatedLyric: translations?.get(line.startTime) ?? line.translatedLyric, romanLyric: romans?.get(line.startTime) ?? line.romanLyric };
  });
}

function LyricRenderer({ lines, onError }: { lines: LyricLine[]; onError: (cause: unknown) => void }) {
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const progress = useProgress(visible);
  const [renderer, setRenderer] = useState<LyricPlayerRef | null>(null);
  const retainRenderer = useCallback((value: LyricPlayerRef | null) => setRenderer(value), []);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const reduced = useReducedMotion();
  const playing = progress.status === "playing";
  const pausedPosition = playing ? 0 : progress.positionMs;
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (!renderer?.wrapperEl || !visible) return;
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1));
    observer.observe(renderer.wrapperEl);
    return () => observer.disconnect();
  }, [renderer, visible]);
  useEffect(() => {
    const player = renderer?.lyricPlayer;
    if (!visible || !player) return;
    let frame = 0;
    let previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      player.setCurrentTime(playing ? currentPosition(now) : pausedPosition);
      player.update(Math.min(50, now - previous));
      previous = now;
      // Let initial/seek/resize layout settle even when entering a paused song.
      if (playing || now - started < 1000) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, playing, pausedPosition, renderer, lines, layoutVersion]);
  // AMLL's automatic frame loop is disabled; only the visible lyric subtree
  // receives an interpolated clock. React does not render on every frame.
  return visible ? <LyricPlayer ref={retainRenderer} className="h-full w-full" lyricLines={lines} disabled playing={playing} currentTime={progress.positionMs}
    onLyricLineClick={(event) => {
      if (!isTauri()) return;
      void nativeCall("player_seek", { positionMs: event.line.getLine().startTime }).catch(onError);
    }}
    enableBlur={!reduced} enableScale={!reduced} enableSpring={!reduced} alignPosition={0.4} /> : null;
}

export default function LyricsView({ onQueue }: { onQueue: () => void }) {
  const state = usePlayer();
  const track = state.index !== null ? state.queue[state.index] : undefined;
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [source, setSource] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [binding, setBinding] = useState("");
  const [refresh, setRefresh] = useState<{ key: string; serial: number }>();
  const refreshTrack = () => { if (track) setRefresh((r) => ({ key: track.key, serial: (r?.serial ?? 0) + 1 })); };
  const generation = useRef(0);
  const apply = useCallback((value: Lyrics | null, duration: number) => {
    setLines(value ? parseLyrics(value, duration) : []);
    setSource(value ? ({ amll: "AMLL DB", netease: "网易云音乐", local: "本地歌词" })[value.source] : undefined);
  }, []);
  useEffect(() => {
    const serial = ++generation.current;
    setLines([]); setSource(undefined); setError(undefined); setLoading(false);
    if (!track || !isTauri()) return;
    setLoading(true);
    const load = async () => {
      let value = await nativeCall<Lyrics | null>("track_lyrics", { key: track.key, refresh: refresh?.key === track.key, skipAmll: false, skipLocal: false });
      if (generation.current !== serial) return;
      try { apply(value, track.durationMs); }
      catch (cause) {
        if (value?.source === "local") {
          value = await nativeCall<Lyrics | null>("track_lyrics", { key: track.key, refresh: false, skipAmll: false, skipLocal: true });
          if (generation.current !== serial) return;
          try { apply(value, track.durationMs); return; }
          catch (fallbackError) { if (value?.source !== "amll") throw fallbackError; }
        } else if (value?.source !== "amll") throw cause;
        value = await nativeCall<Lyrics | null>("track_lyrics", { key: track.key, refresh: false, skipAmll: true, skipLocal: true });
        if (generation.current === serial) apply(value, track.durationMs);
      }
    };
    void load().catch((cause) => { if (generation.current === serial) setError(errorText(cause)); }).finally(() => { if (generation.current === serial) setLoading(false); });
    return () => { generation.current++; };
  }, [track?.key, refresh, apply]);
  useEffect(() => {
    if (!isTauri() || !track) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ key: string; lyrics: Lyrics }>("lyrics-updated", ({ payload }) => {
      if (!disposed && payload.key === track.key) { try { apply(payload.lyrics, track.durationMs); } catch { /* Retain the last usable lyrics. */ } }
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch((cause) => setError(errorText(cause)));
    return () => { disposed = true; stop?.(); };
  }, [track?.key, apply]);

  const showLyrics = lines.length > 0 || loading;
  return <section className="nons-lyrics now-playing-enter absolute inset-0 flex flex-col pt-12" aria-label="正在播放">
    <AlbumBackground cover={track?.cover} playing={state.status === "playing"} hasLyrics={lines.length > 0} />
    <div className={`now-playing-layout relative min-h-0 flex-1 ${showLyrics ? "has-lyrics" : ""}`}>
    <div className="now-playing-details flex min-h-0 min-w-0 flex-col justify-center gap-5 overflow-y-auto">
      <div className="now-playing-cover-slot"><Cover cover={track?.cover} className="now-playing-cover aspect-square rounded-xl shadow-2xl" /></div>
      <div className="flex shrink-0 items-start justify-between gap-4"><div className="min-w-0"><h1 className="truncate text-xl font-semibold tracking-tight">{track?.title ?? "让音乐开始"}</h1><p className="mt-1 truncate text-muted-foreground">{track?.artist ?? "选择一首喜欢的音乐"}</p></div><ActionButton variant="ghost" size="icon-sm" disabled={!track || loading} aria-label="刷新歌词" title={`刷新歌词 · ${source ?? "暂无歌词"}`} onClick={refreshTrack}><RefreshCw aria-hidden="true" /></ActionButton></div>
      <NowPlayingControls onQueue={onQueue} onError={(cause) => setError(errorText(cause))} />
      {track?.source.kind === "local" && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">匹配在线歌词</summary><form className="mt-3 space-y-2" onSubmit={(event) => {
        event.preventDefault(); const id = Number(binding);
        if (!Number.isSafeInteger(id) || id <= 0) { setError("请输入有效的网易云歌曲 ID。"); return; }
        void nativeCall("bind_local_lyrics", { key: track.key, neteaseId: id }).then(refreshTrack).catch((cause) => setError(errorText(cause)));
      }}><label htmlFor="lyric-binding">对应版本的网易云歌曲 ID</label><div className="flex gap-2"><input id="lyric-binding" inputMode="numeric" value={binding} onChange={(e) => setBinding(e.target.value)} className="music-input min-w-0 flex-1" /><ActionButton type="submit" variant="secondary" disabled={loading}>绑定</ActionButton></div><p className="text-xs text-muted-foreground">请确认是同一录音版本，本地歌词文件始终优先。</p></form></details>}
      {(error || state.error || state.mediaError) && <p role="alert" className="text-sm">{error ?? state.error ?? state.mediaError}</p>}
    </div>
    {showLyrics && <div className="now-playing-lyrics min-h-0 min-w-0 overflow-hidden">{lines.length ? <LyricRenderer key={track?.key} lines={lines} onError={(cause) => setError(errorText(cause))} /> : <div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">正在查找歌词…</div>}</div>}
    </div>
  </section>;
}
