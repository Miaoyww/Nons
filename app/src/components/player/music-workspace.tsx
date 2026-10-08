import { usePlaybackShortcuts } from "@/hooks/use-playback-shortcuts";
import { CollectionActionsProvider } from "./collection-actions";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Music2, Plus, X } from "lucide-react";
import { FolderManager } from "@/components/settings/folder-manager";
import { invalidateNativeCache } from "@/lib/runtime-cache";
import { AnimatePresence } from "motion/react";
import { connectPlayer, errorText, nativeCall, usePlayer, type Track } from "@/lib/player";
import { ActionButton } from "./action-button";
import { PlaybackBar } from "./playback-bar";
import type { PlaybackNoticeMessage } from "./playback-notice";
import { useMusicNavigation } from "./music-navigation";
import { QualitySelect } from "./music-options";
import { SongActionsProvider } from "./song-actions";
import { QueuePage } from "./queue-page";
import { TrackList } from "./track-list";
import { InfiniteLoad } from "./infinite-load";
import { usePagedList } from "@/lib/use-paged-list";
import { PluginPageHost } from "@/plugins/host";

const SearchPage = lazy(() => import("./search-page"));
const ArtistPage = lazy(() => import("./artist-page"));
const AlbumPage = lazy(() => import("./album-page"));
const Discovery = lazy(() => import("./discovery"));
const LyricsView = lazy(() => import("./lyrics-view"));
const MusicLibrary = lazy(() => import("./music-library"));
interface ImportReport { imported: number; skipped: number; errors: string[] }

export function MusicWorkspace({ nowPlaying, playerVisible, onNowPlayingChange, onPlayerExitComplete }: { nowPlaying: boolean; playerVisible: boolean; onNowPlayingChange: (value: boolean) => void; onPlayerExitComplete: () => void }) {
  const state = usePlayer();
  const { page, navigate } = useMusicNavigation();
  const view = page.view;
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page) { previousPage.current = page; onNowPlayingChange(false); }
  }, [page, onNowPlayingChange]);
  const [queueVisit, setQueueVisit] = useState(0);
  const openQueue = () => { setQueueVisit((value) => value + 1); navigate("queue"); onNowPlayingChange(false); };
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<PlaybackNoticeMessage>();
  const noticeSerial = useRef(0);
  const showNotice = useCallback((message: string) => setNotice({ id: ++noticeSerial.current, message }), []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [refresh, setRefresh] = useState(0);
  const onError = useCallback((cause: unknown) => setError(errorText(cause)), []);
  usePlaybackShortcuts(onError);
  const current = state.index !== null ? state.queue[state.index] : undefined;
  const wasPlayerVisible = useRef(playerVisible);

  useEffect(() => {
    if (wasPlayerVisible.current && !playerVisible) document.querySelector<HTMLButtonElement>('[aria-label="打开正在播放"]')?.focus();
    wasPlayerVisible.current = playerVisible;
  }, [playerVisible]);


  useEffect(() => {
    if (!nowPlaying) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onNowPlayingChange(false);
    };
    document.addEventListener("keydown", exit);
    return () => { document.removeEventListener("keydown", exit); };
  }, [nowPlaying, onNowPlayingChange]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void connectPlayer().then((cleanup) => { if (disposed) cleanup(); else stop = cleanup; }).catch(onError);
    return () => { disposed = true; stop?.(); };
  }, [onError]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false; let stop: (() => void) | undefined;
    void listen<{ scanning?: boolean; error?: string }>("local-library-updated", ({ payload }) => {
      if (disposed) return;
      if (payload?.error) onError(payload.error);
      if (!payload?.scanning) { invalidateNativeCache(["local_music", "track_lyrics"]); setRefresh((value) => value + 1); }
    }).then((fn) => { if (disposed) fn(); else stop = fn; }).catch(onError);
    return () => { disposed = true; stop?.(); };
  }, [onError]);

  const loader = useCallback(async (offset: number) => {
    const values = await nativeCall<Track[]>("local_music", { keyword: page.query, offset });
    return { items: values, more: values.length === 100 };
  }, [page, refresh]);
  const { items: tracks, more: hasMore, busy, error: loadError, loadMore } = usePagedList(loader, 100,
    isTauri() && view === "local");

  async function importMusic(directory: boolean) {
    setError(undefined); setNotice(undefined);
    try {
      const selected = await open({ directory, multiple: !directory, title: directory ? "导入音乐目录" : "打开音乐文件", filters: directory ? undefined : [{ name: "音频", extensions: ["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "aiff", "ape", "wv"] }] });
      if (!selected) return;
      setImporting(true);
      const report = await nativeCall<ImportReport>("import_music", { paths: Array.isArray(selected) ? selected : [selected] });
      showNotice(`已导入 ${report.imported} 首音乐${report.skipped ? `，跳过 ${report.skipped} 个无法读取的文件` : ""}。`);
      if (report.errors.length) setError(report.errors.join("；"));
      if (view === "local") setRefresh((value) => value + 1); else navigate("local");
    } catch (cause) { onError(cause); }
    finally { setImporting(false); }
  }

  const play = useCallback((index: number) => {
    void nativeCall("play_queue", { keys: tracks.map((t) => t.key), index }).catch(onError);
  }, [view, tracks, onError]);
  const append = useCallback((track: Track) => {
    void nativeCall("append_queue", { keys: [track.key] }).then(() => showNotice(`已将「${track.title}」设为下一首播放。`)).catch(onError);
  }, [onError, showNotice]);

  return <CollectionActionsProvider onError={onError} onNotice={showNotice}><SongActionsProvider onError={onError} onNotice={showNotice}><div className="music-workspace flex min-h-0 flex-1 flex-col">
    <Suspense fallback={<div role="status" className="m-auto">正在加载播放器…</div>}>
      <AnimatePresence onExitComplete={onPlayerExitComplete}>
        {nowPlaying && <LyricsView key="now-playing" onQueue={openQueue} />}
      </AnimatePresence>
    </Suspense>
    <div className={nowPlaying ? "hidden" : "flex min-h-0 flex-1"}>
      <main id="music-content" className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="音乐工作区">
        {!isTauri() && <p role="status" className="border-b border-border bg-muted/50 px-8 py-3 text-sm text-muted-foreground">这是界面预览。播放、搜索和导入功能需要在桌面应用中使用。</p>}
        {(error || state.error || state.mediaError) && <div role="alert" className="flex items-start gap-3 border-b border-border bg-destructive/5 px-8 py-3 text-sm text-destructive"><p className="min-w-0 flex-1">{error ?? state.error ?? state.mediaError}</p>{error && <ActionButton variant="ghost" size="icon-sm" aria-label="关闭提示" onClick={() => setError(undefined)}><X aria-hidden="true" /></ActionButton>}</div>}
        {(view === "artist" || view === "album") && page.collection ? <Suspense fallback={<p role="status" className="m-auto">正在加载音乐详情…</p>}>{view === "artist" ? <ArtistPage key={page.collection.id} collection={page.collection} onError={onError} onNotice={showNotice} /> : <AlbumPage key={page.collection.id} collection={page.collection} onError={onError} onNotice={showNotice} />}</Suspense> : view === "plugin" ? <PluginPageHost path={page.query} /> : view === "queue" ? <QueuePage key={queueVisit} onError={onError} /> : view === "search" ? <Suspense fallback={<p role="status" className="m-auto">正在加载搜索页…</p>}><SearchPage key={page.query} onError={onError} onNotice={showNotice} /></Suspense> : view === "discover" ? <Suspense fallback={<p role="status" className="m-auto">正在加载发现页…</p>}><Discovery onError={onError} onNotice={showNotice} /></Suspense> : view === "library" || view === "collection" ? <Suspense fallback={<p role="status" className="m-auto">正在加载音乐库…</p>}><MusicLibrary onError={onError} onNotice={showNotice} /></Suspense> : <>
          <header className="flex shrink-0 items-center justify-between gap-6 px-8 pb-6 pt-8"><div><h1 className="text-2xl font-semibold tracking-tight">本地音乐</h1><p className="mt-2 text-sm text-muted-foreground">熟悉的收藏，随时聆听。</p></div>
          </header>
          {view === "local" && <div className="flex items-center justify-between gap-4 px-8 pb-4"><div className="min-w-0"><h2 className="text-base font-semibold">音乐文件夹</h2><p className="mt-1 text-xs text-muted-foreground">添加或移除本地音乐文件夹。已添加的文件夹会自动扫描。</p></div><div className="flex shrink-0 gap-2"><ActionButton variant="ghost" disabled={importing || !isTauri()} onClick={() => void importMusic(false)}><Plus aria-hidden="true" />打开文件</ActionButton><FolderManager /></div></div>}
          <div className="relative isolate min-h-0 flex-1 overflow-auto px-8">
            {tracks.length > 0 ? <TrackList tracks={tracks} currentKey={current?.key} busy={false} onPlay={play} onAppend={append} /> : <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center"><Music2 className="size-10 text-muted-foreground/60" aria-hidden="true" /><p className="font-medium">{busy ? "正在查找音乐…" : "把你的音乐带进来"}</p><p className="max-w-sm text-sm leading-6 text-muted-foreground">打开音频文件，或导入一个音乐目录。曲库会在下次启动时保留。</p></div>}
            {view === "local" && <InfiniteLoad more={hasMore} busy={busy} error={loadError} onLoad={loadMore} />}
          </div>

        </>}
      </main>
    </div>
    {!playerVisible && <PlaybackBar notice={notice} qualityControl={<QualitySelect />} onLyrics={() => onNowPlayingChange(true)} onQueue={openQueue} onError={onError} />}
  </div></SongActionsProvider></CollectionActionsProvider>;
}
