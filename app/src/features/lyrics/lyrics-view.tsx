import { useLocalPreferences } from "@/features/local/use-local-preferences";
import { TrackArtists } from "@/components/music/music-links";
import { LyricPlayer, type LyricPlayerRef } from "@applemusic-like-lyrics/react";
import type { LyricLine } from "@applemusic-like-lyrics/core";
import "@applemusic-like-lyrics/core/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { AudioLines, Languages } from "lucide-react";
import { currentPosition, errorText, getPlayer, nativeCall, usePlayer, useProgress, type Lyrics } from "@/lib/player";
import { ActionButton } from "@/components/music/action-button";
import { Cover } from "@/components/music/cover";
import { AlbumBackground } from "@/features/lyrics/album-background";
import { NowPlayingControls } from "@/features/playback/now-playing-controls";
import { NowPlayingMenu } from "@/features/playback/now-playing-menu";
import { useLyricSources } from "@/features/lyrics/use-lyric-sources";
import { loadLyrics } from "@/features/lyrics/load-lyrics";
import { EmptyLyricsError, parseLyrics } from "@/features/lyrics/parse-lyrics";
import { useFontSettings } from "@/features/settings/use-font-settings";

function isCurrentPlayback(key: string, revision: number) {
  const active = getPlayer();
  return active.revision === revision && active.index !== null && active.queue[active.index]?.key === key;
}

function LyricRenderer({ lines, showTranslation = true, showPronunciation = true, onError }: {
  lines: LyricLine[]; showTranslation?: boolean; showPronunciation?: boolean; onError: (cause: unknown) => void;
}) {
  const { fonts } = useFontSettings();
  const lyricFont = fonts.lyrics || fonts.app;
  // AMLL consumes immutable lyric lines; retain the original auxiliary lyrics for restoring them.
  const displayedLines = useMemo(() => showTranslation && showPronunciation ? lines : lines.map((line) => ({
    ...line,
    translatedLyric: showTranslation ? line.translatedLyric : "",
    romanLyric: showPronunciation ? line.romanLyric : "",
    words: showPronunciation ? line.words : line.words.map((word) => ({ ...word, romanWord: undefined, ruby: undefined })),
  })), [lines, showTranslation, showPronunciation]);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const progress = useProgress(visible);
  const [renderer, setRenderer] = useState<LyricPlayerRef | null>(null);
  const retainRenderer = useCallback((value: LyricPlayerRef | null) => setRenderer(value), []);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const reduced = useReducedMotion();
  const playing = progress.status === "playing";
  const pausedPosition = playing ? 0 : progress.positionMs;
  useEffect(() => {
    const player = renderer?.lyricPlayer;
    if (!visible || !player) return;
    let disposed = false;
    let frame = 0;
    // Font metrics affect word masks as well as line positions, including while paused.
    void document.fonts.ready.then(() => {
      if (disposed) return;
      frame = requestAnimationFrame(() => {
        player.rebuildLyricView();
        setLayoutVersion((version) => version + 1);
      });
    });
    return () => { disposed = true; cancelAnimationFrame(frame); };
  }, [lyricFont, renderer, visible]);
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
  }, [visible, playing, pausedPosition, renderer, displayedLines, layoutVersion]);
  // AMLL's automatic frame loop is disabled; only the visible lyric subtree
  // receives an interpolated clock. React does not render on every frame.
  return visible ? <LyricPlayer ref={retainRenderer} className="h-full w-full" lyricLines={displayedLines} disabled playing={playing} currentTime={progress.positionMs}
    onLyricLineClick={(event) => {
      if (!isTauri()) return;
      void nativeCall("player_seek", { positionMs: event.line.getLine().startTime }).catch(onError);
    }}
    enableBlur={!reduced} enableScale={!reduced} enableSpring={!reduced} alignPosition={0.4} /> : null;
}

export default function LyricsView({ onQueue }: { onQueue: () => void }) {
  const reduced = useReducedMotion();
  const isPresent = useIsPresent();
  const state = usePlayer();
  const track = state.index !== null ? state.queue[state.index] : undefined;
  const [display, setDisplay] = useState<{ key: string; revision: number; lines: LyricLine[]; source?: string }>();
  const currentDisplay = display?.key === track?.key && display?.revision === state.revision ? display : undefined;
  const lines = currentDisplay?.lines ?? [];
  const source = currentDisplay?.source;
  const { sources } = useLyricSources();
  const { options: localPreferences } = useLocalPreferences();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [showTranslation, setShowTranslation] = useState(true);
  const [showPronunciation, setShowPronunciation] = useState(true);
  const hasTranslation = lines.some((line) => !!line.translatedLyric.trim());
  const hasPronunciation = lines.some((line) => !!line.romanLyric.trim() || line.words.some((word) => !!word.romanWord?.trim() || !!word.ruby?.length));
  const generation = useRef(0);
  const appliedSource = useRef<string | undefined>(undefined);
  const apply = useCallback((value: Lyrics | null, duration: number, key: string, revision: number) => {
    const parsed = value ? parseLyrics(value, duration) : [];
    appliedSource.current = value?.source;
    setDisplay({ key, revision, lines: parsed, source: value ? ({ amll: "AMLL DB", qq: "QQ 音乐", netease: "网易云音乐", local: "本地歌词" })[value.source] : undefined });
  }, []);
  useEffect(() => {
    const serial = ++generation.current;
    appliedSource.current = undefined;
    setDisplay(undefined); setError(undefined); setLoading(false);
    if (!track || !isTauri()) return;
    setLoading(true);
    // Native playback can switch before React's passive-effect cleanup runs.
    const isCurrent = () => generation.current === serial && isCurrentPlayback(track.key, state.revision);
    const load = async () => {
      await loadLyrics(track, false, sources,
        (value) => apply(value, track.durationMs, track.key, state.revision), isCurrent);
    };
    void load().catch((cause) => {
      if (isCurrent() && !(cause instanceof EmptyLyricsError)) setError(errorText(cause));
    }).finally(() => { if (isCurrent()) setLoading(false); });
    return () => { generation.current++; };
  }, [track?.key, state.revision, apply, sources, localPreferences]);
  useEffect(() => {
    if (!isTauri() || !track) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ key: string; lyrics: Lyrics }>("lyrics-updated", ({ payload }) => {
      if (!disposed && isCurrentPlayback(track.key, state.revision)
        && appliedSource.current === payload.lyrics.source && payload.key === track.key && (payload.lyrics.source !== "amll" || sources.amll) && (payload.lyrics.source !== "qq" || sources.qq)) {
        try { apply(payload.lyrics, track.durationMs, track.key, state.revision); } catch { /* Retain the last usable lyrics. */ }
      }
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch((cause) => {
      if (!disposed && isCurrentPlayback(track.key, state.revision)) setError(errorText(cause));
    });
    return () => { disposed = true; stop?.(); };
  }, [track?.key, state.revision, apply, sources, localPreferences]);

  const showLyrics = lines.length > 0 || loading;
  return <motion.section className="nons-lyrics now-playing absolute inset-0 z-[5] flex flex-col pt-12" aria-label="正在播放" aria-hidden={!isPresent} inert={!isPresent}
    initial={{ y: reduced ? 0 : "100%" }}
    animate={{ y: 0 }}
    transition={{ type: "tween", duration: reduced ? 0 : 0.42, ease: [0.22, 0, 0.18, 1] }}
    exit={{ y: reduced ? 0 : "100%", transition: { type: "tween", duration: reduced ? 0 : 0.3, ease: [0.4, 0, 1, 1] } }}>
    <AlbumBackground cover={track?.cover} playing={state.status === "playing"} hasLyrics={lines.length > 0} />
    <div className="lyrics-display-controls" role="group" aria-label="歌词显示">
      <ActionButton variant="ghost" size="icon" disabled={!hasTranslation} aria-label="显示歌词翻译" aria-pressed={hasTranslation && showTranslation}
        title={hasTranslation ? (showTranslation ? "隐藏翻译" : "显示翻译") : "暂无翻译"} onClick={() => setShowTranslation((value) => !value)}><Languages aria-hidden="true" /></ActionButton>
      <ActionButton variant="ghost" size="icon" disabled={!hasPronunciation} aria-label="显示歌词发音" aria-pressed={hasPronunciation && showPronunciation}
        title={hasPronunciation ? (showPronunciation ? "隐藏发音" : "显示发音") : "暂无发音"} onClick={() => setShowPronunciation((value) => !value)}><AudioLines aria-hidden="true" /></ActionButton>
    </div>
    <div className={`now-playing-layout relative min-h-0 flex-1 ${showLyrics ? "has-lyrics" : ""}`}>
    <div className="now-playing-details flex min-h-0 min-w-0 flex-col justify-center gap-5 overflow-y-auto">
      <div className="now-playing-cover-slot"><Cover cover={track?.cover} className="now-playing-cover aspect-square rounded-xl shadow-2xl" /></div>
      <div className="flex shrink-0 items-start justify-between gap-4"><div className="min-w-0"><h1 className="truncate text-xl font-semibold tracking-tight">{track?.title ?? "让音乐开始"}</h1><p className="mt-1 truncate text-muted-foreground">{track ? <TrackArtists track={track} /> : "选择一首喜欢的音乐"}</p></div><NowPlayingMenu disabled={!track} source={source} /></div>
      <NowPlayingControls onQueue={onQueue} onError={(cause) => setError(errorText(cause))} />
      {(error || state.error || state.mediaError) && <p role="alert" className="text-sm">{error ?? state.error ?? state.mediaError}</p>}
    </div>
    {showLyrics && <div className="now-playing-lyrics min-h-0 min-w-0 overflow-hidden">{lines.length ? <LyricRenderer key={track?.key} lines={lines} showTranslation={showTranslation} showPronunciation={showPronunciation} onError={(cause) => setError(errorText(cause))} /> : <div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">正在查找歌词…</div>}</div>}
    </div>
  </motion.section>;
}
