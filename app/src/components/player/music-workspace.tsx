import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, Music2, Plus, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { connectPlayer, errorText, nativeCall, usePlayer, type Track } from "@/lib/player";
import { ActionButton } from "./action-button";
import { PlaybackBar } from "./playback-bar";
import { useMusicNavigation } from "./music-navigation";
import { QualitySelect } from "./music-options";
import { TrackList } from "./track-list";

const LyricsView = lazy(() => import("./lyrics-view"));
const MusicLibrary = lazy(() => import("./music-library"));
interface ImportReport { imported: number; skipped: number; errors: string[] }

export function MusicWorkspace({ nowPlaying, onNowPlayingChange }: { nowPlaying: boolean; onNowPlayingChange: (value: boolean) => void }) {
  const state = usePlayer();
  const { page, navigate } = useMusicNavigation();
  const view = page.view;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const generation = useRef(0);
  const onError = useCallback((cause: unknown) => setError(errorText(cause)), []);
  const current = state.index !== null ? state.queue[state.index] : undefined;


  useEffect(() => {
    if (!nowPlaying) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onNowPlayingChange(false);
    };
    document.addEventListener("keydown", exit);
    return () => { document.removeEventListener("keydown", exit); document.querySelector<HTMLButtonElement>('[aria-label="打开正在播放"]')?.focus(); };
  }, [nowPlaying, onNowPlayingChange]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void connectPlayer().then((cleanup) => { if (disposed) cleanup(); else stop = cleanup; }).catch(onError);
    return () => { disposed = true; stop?.(); };
  }, [onError]);

  const load = useCallback(async (page: number, search: string, target: "local" | "search") => {
    const serial = ++generation.current;
    if (!isTauri()) { setTracks([]); return; }
    setBusy(true); setError(undefined);
    try {
      const values = await nativeCall<Track[]>(target === "local" ? "local_music" : "search_music", { keyword: search, offset: page });
      if (generation.current !== serial) return;
      // Keep only one page in memory and the DOM, even for a large local library.
      setTracks(values); setOffset(page); setAppliedKeyword(search);
      setHasMore(values.length === (target === "local" ? 100 : 50));
    } catch (cause) { if (generation.current === serial) onError(cause); }
    finally { if (generation.current === serial) setBusy(false); }
  }, [onError]);

  useEffect(() => {
    generation.current++; setBusy(false); setAppliedKeyword(""); setTracks([]); setOffset(0); setHasMore(false);
    if (view === "local" || view === "search") void load(0, page.query, view);
    return () => { generation.current++; };
  }, [page, load]);

  async function importMusic(directory: boolean) {
    setError(undefined); setNotice(undefined);
    try {
      const selected = await open({ directory, multiple: !directory, title: directory ? "导入音乐目录" : "打开音乐文件", filters: directory ? undefined : [{ name: "音频", extensions: ["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "aiff", "ape", "wv"] }] });
      if (!selected) return;
      setImporting(true);
      const report = await nativeCall<ImportReport>("import_music", { paths: Array.isArray(selected) ? selected : [selected] });
      setNotice(`已导入 ${report.imported} 首音乐${report.skipped ? `，跳过 ${report.skipped} 个无法读取的文件` : ""}。`);
      if (report.errors.length) setError(report.errors.join("；"));
      if (view === "local") await load(0, appliedKeyword, "local"); else navigate("local");
    } catch (cause) { onError(cause); }
    finally { setImporting(false); }
  }

  const play = useCallback((index: number) => {
    void nativeCall(view === "queue" ? "player_jump" : "play_queue", view === "queue" ? { index } : { keys: tracks.map((t) => t.key), index }).catch(onError);
  }, [view, tracks, onError]);
  const append = useCallback((track: Track) => {
    void nativeCall("append_queue", { keys: [track.key] }).then(() => setNotice(`已将「${track.title}」加入播放队列。`)).catch(onError);
  }, [onError]);

  return <div className="music-workspace flex min-h-0 flex-1 flex-col">
    <Suspense fallback={<div role="status" className="m-auto">正在加载播放器…</div>}>
      <AnimatePresence>
        {nowPlaying && <LyricsView key="now-playing" onQueue={() => { navigate("queue"); onNowPlayingChange(false); }} />}
      </AnimatePresence>
    </Suspense>
    <div className={nowPlaying ? "hidden" : "flex min-h-0 flex-1"}>
      <main id="music-content" className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="音乐工作区">
        {!isTauri() && <p role="status" className="border-b border-border bg-muted/50 px-8 py-3 text-sm text-muted-foreground">这是界面预览。播放、搜索和导入功能需要在桌面应用中使用。</p>}
        {(error || state.error || state.mediaError) && <div role="alert" className="flex items-start gap-3 border-b border-border bg-destructive/5 px-8 py-3 text-sm text-destructive"><p className="min-w-0 flex-1">{error ?? state.error ?? state.mediaError}</p>{error && <ActionButton variant="ghost" size="icon-sm" aria-label="关闭提示" onClick={() => setError(undefined)}><X aria-hidden="true" /></ActionButton>}</div>}
        {notice && <p role="status" className="border-b border-border px-8 py-2 text-sm text-muted-foreground">{notice}</p>}
        {view === "library" || view === "collection" ? <Suspense fallback={<p role="status" className="m-auto">正在加载音乐库…</p>}><MusicLibrary onError={onError} /></Suspense> : <>
          <header className="flex shrink-0 items-center justify-between gap-6 px-8 pb-6 pt-8"><div><h1 className="text-2xl font-semibold tracking-tight">{view === "local" ? "本地音乐" : view === "search" ? "搜索音乐" : view === "discover" ? "发现" : "播放队列"}</h1><p className="mt-2 text-sm text-muted-foreground">{view === "local" ? "熟悉的收藏，随时聆听。" : view === "search" || view === "discover" ? "在网易云音乐中寻找下一首。" : `${state.queue.length} 首音乐，按顺序播放。`}</p></div>
          </header>
          {view === "local" && <div className="flex gap-2 px-8 pb-4"><ActionButton variant="secondary" disabled={importing || !isTauri()} onClick={() => void importMusic(false)}><Plus aria-hidden="true" />打开文件</ActionButton><ActionButton variant="outline" disabled={importing || !isTauri()} onClick={() => void importMusic(true)}><FolderPlus aria-hidden="true" />{importing ? "正在导入…" : "导入目录"}</ActionButton></div>}
          <div className="relative isolate min-h-0 flex-1 overflow-auto px-8">
            {(view === "queue" ? state.queue.length : tracks.length) > 0 ? <TrackList offset={view === "queue" ? 0 : offset} tracks={view === "queue" ? state.queue : tracks} currentKey={current?.key} busy={busy} onPlay={play} onAppend={view === "queue" ? undefined : append} /> : <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center"><Music2 className="size-10 text-muted-foreground/60" aria-hidden="true" /><p className="font-medium">{busy ? "正在查找音乐…" : view === "local" ? "把你的音乐带进来" : view === "search" || view === "discover" ? appliedKeyword ? "没有找到匹配的音乐" : "下一首喜欢的音乐，等你发现" : "队列还是空的"}</p><p className="max-w-sm text-sm leading-6 text-muted-foreground">{view === "local" ? "打开音频文件，或导入一个音乐目录。曲库会在下次启动时保留。" : view === "search" || view === "discover" ? "在顶部搜索框输入歌曲或艺术家名称开始搜索。" : "从搜索结果或本地曲库，将歌曲加入播放队列。"}</p></div>}
          </div>
          {(view === "local" || view === "search") && <div className="flex h-14 shrink-0 items-center justify-between border-t border-border/50 px-8 text-xs text-muted-foreground"><span>{tracks.length ? `${offset + 1}–${offset + tracks.length}` : ""}</span><div className="flex gap-2"><ActionButton size="sm" variant="ghost" disabled={!offset || busy} onClick={() => void load(Math.max(0, offset - (view === "local" ? 100 : 50)), appliedKeyword, view)}>上一页</ActionButton><ActionButton size="sm" variant="ghost" disabled={!hasMore || busy} onClick={() => void load(offset + (view === "local" ? 100 : 50), appliedKeyword, view)}>下一页</ActionButton></div></div>}
        </>}
      </main>
    </div>
    {!nowPlaying && <PlaybackBar qualityControl={<QualitySelect />} onLyrics={() => onNowPlayingChange(true)} onQueue={() => navigate("queue")} onError={onError} />}
  </div>;
}
