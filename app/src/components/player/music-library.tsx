import { TrackArtists } from "./music-links";
import { AlbumCard } from "./album-card";
import { PlaylistCard } from "./playlist-card";
import { CollectionHeader } from "./collection-header";
import { SongContextMenu } from "./song-actions";
import { TrackTitle } from "./track-title";
// Layout and interaction adapted from YesPlayMusic src/views/library.vue.
// Copyright (c) 2020-2023 qier222, MIT. See notices/YesPlayMusic-LICENSE.txt.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Heart, Play, Plus, RefreshCw, UserRound } from "lucide-react";
import { errorText, nativeCall, usePlayer, type Track } from "@/lib/player";
import { getLibraryCollections, getLibraryHistory, getLibraryTracks, getMusicLibrary, peekMusicLibrary, invalidateMusicLibrary, playLibraryCollection,
  type CollectionTracks, type LibrarySummary, type LibraryTab, type PlaylistFilter } from "@/lib/music-library";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/base/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionButton } from "./action-button";
import { useAccount } from "./account";
import { Cover } from "./cover";
import { LoginDialog } from "./login-dialog";
import { useMusicNavigation, type MusicCollection } from "./music-navigation";
import { TrackList } from "./track-list";
import { InfiniteLoad } from "./infinite-load";
import { usePagedList } from "@/lib/use-paged-list";
import { useLyricSources } from "@/hooks/use-lyric-sources";
import { loadLyrics } from "@/lib/load-lyrics";

const filters = [{ value: "all", label: "全部歌单" }, { value: "mine", label: "创建的歌单" }, { value: "liked", label: "收藏的歌单" }];
const tabs = [{ value: "playlist", label: "歌单" }, { value: "album", label: "专辑" }, { value: "artist", label: "艺人" }, { value: "history", label: "听歌记录" }] as const;

function CreatePlaylist({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [privatePlaylist, setPrivatePlaylist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError(undefined);
    try {
      await nativeCall("create_library_playlist", { name: name.trim(), private: privatePlaylist });
      setOpen(false); setName(""); onCreated();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(undefined); } }}>
    <DialogTrigger render={<ActionButton variant="ghost" size="sm" />}><Plus aria-hidden="true" />新建歌单</DialogTrigger>
    <DialogPopup className="max-w-sm">
      <DialogTitle>新建歌单</DialogTitle><DialogDescription>把喜欢的音乐整理成一个歌单。</DialogDescription>
      <form onSubmit={(event) => void create(event)} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm">歌单名称<input autoFocus className="music-input w-full" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} required disabled={busy} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={privatePlaylist} onChange={(event) => setPrivatePlaylist(event.target.checked)} disabled={busy} />设为私密歌单</label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><DialogClose render={<ActionButton variant="outline" disabled={busy} />}>取消</DialogClose><ActionButton type="submit" disabled={busy || !name.trim()}>{busy ? "正在创建…" : "创建"}</ActionButton></div>
      </form>
    </DialogPopup>
  </Dialog>;
}

function LyricExcerpt({ track }: { track?: Track }) {
  const { sources } = useLyricSources();
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let disposed = false;
    setLines([]);
    if (!track || !isTauri()) return;
    const load = async () => {
      const { parseLyrics } = await import("@/lib/parse-lyrics");
      if (disposed) return;
      const result = await loadLyrics(track, false, sources, (value) => value ? parseLyrics(value, track.durationMs) : [], () => !disposed);
      if (!result || disposed) return;
      const excerpt = result.parsed.map((line) => line.words.map((word) => word.word).join("").trim())
        .filter((line) => line && !/作词|作曲|纯音乐|编曲/.test(line));
      const start = Math.floor(Math.random() * Math.max(1, excerpt.length - 2));
      setLines(excerpt.slice(start, start + 3));
    };
    void load().catch(() => { /* Optional lyrics never block the collection or playback. */ });
    return () => { disposed = true; };
  }, [track?.key, sources]);
  return lines.length ? <p className="library-lyric-excerpt">{lines.map((line, index) => <span key={index}>{line}<br /></span>)}</p> : <Heart className="size-10 opacity-30" aria-hidden="true" />;
}

function CollectionCards({ items, busy, onOpen, onPlay }: { items: MusicCollection[]; busy: boolean; onOpen: (item: MusicCollection) => void; onPlay: (item: MusicCollection) => void }) {
  return <div className={items[0]?.kind === "album" ? "discover-playlist-grid" : "library-cover-grid"}>{items.map((item) => item.kind === "album" ? <AlbumCard key={`${item.kind}:${item.id}`} item={item} busy={busy} onOpen={onOpen} onPlay={onPlay} /> : <PlaylistCard key={`${item.kind}:${item.id}`} item={item} busy={busy} onOpen={onOpen} onPlay={onPlay} />)}</div>;
}

export default function MusicLibrary({ onError, onNotice }: { onError: (cause: unknown) => void; onNotice: (message: string) => void }) {
  const { profile, loading: accountLoading, error: accountError, likesRevision, reloadLikes } = useAccount();
  const { page, navigate } = useMusicNavigation();
  const player = usePlayer();
  const currentKey = player.index !== null ? player.queue[player.index]?.key : undefined;
  const [summary, setSummary] = useState<LibrarySummary>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string>();
  const [tab, setTab] = useState<LibraryTab>("playlist");
  const [filter, setFilter] = useState<PlaylistFilter>("all");
  const [week, setWeek] = useState(true);
  const collection = page.collection;
  const [playing, setPlaying] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const showingDetail = page.view === "collection" && !!collection;

  useEffect(() => {
    let disposed = false;
    setSummary(undefined); setSummaryError(undefined); setSummaryBusy(false);
    if (!profile || !isTauri()) return;
    const cached = peekMusicLibrary(profile.userId);
    setSummary(cached); setSummaryBusy(!cached);
    void getMusicLibrary(profile.userId).then((value) => { if (!disposed) setSummary(value); })
      .catch((cause) => { if (!disposed) setSummaryError(errorText(cause)); })
      .finally(() => { if (!disposed) setSummaryBusy(false); });
    return () => { disposed = true; };
  }, [profile, refresh, likesRevision]);

  const listLoader = useCallback(async (offset: number) => {
    if (tab === "history") {
      const value = await getLibraryHistory(week, offset);
      return { items: value.tracks, more: value.more };
    }
    const value = await getLibraryCollections(tab, offset, filter);
    return { items: value.items, more: value.more };
  }, [profile, tab, filter, week, refresh, showingDetail]);
  const list = usePagedList<Track | MusicCollection>(listLoader, tab === "history" ? 100 : 30, !!profile && isTauri() && !showingDetail);
  const collections = { items: list.items as MusicCollection[], more: list.more };
  const history = { tracks: list.items as Track[], more: list.more };
  const listBusy = list.busy;
  const detailLoader = useCallback(async (offset: number) => {
    const value = await getLibraryTracks(collection!, offset, profile!.userId);
    return { items: value.tracks, more: value.more, metadata: value };
  }, [collection, profile, refresh, showingDetail, likesRevision]);
  const detailList = usePagedList<Track, CollectionTracks>(detailLoader, 100, !!collection && !!profile && showingDetail && isTauri());
  const detail = { ...detailList.metadata, tracks: detailList.items, total: detailList.metadata?.total ?? 0, more: detailList.more };
  const detailBusy = detailList.busy;

  function openCollection(item: MusicCollection) { navigate("collection", "", item); }
  async function playCollection(item: MusicCollection, key?: string) {
    if (playing) return;
    setPlaying(true);
    try {
      const truncated = await playLibraryCollection(item, key);
      if (truncated) onNotice("已将前 1000 首歌曲加入播放队列。其余歌曲可在收藏详情中继续浏览并播放。");
    } catch (cause) { onError(cause); }
    finally { setPlaying(false); }
  }
  function playPage(tracks: Track[], index: number) {
    void nativeCall("play_queue", { keys: tracks.map((track) => track.key), index }).catch(onError);
  }
  function append(track: Track) {
    void nativeCall("append_queue", { keys: [track.key] }).then(() => onNotice(`已将「${track.title}」设为下一首播放。`)).catch(onError);
  }
  async function removeFromPlaylist(item: MusicCollection, track: Track) {
    if (track.source.kind !== "netease") return;
    await nativeCall("remove_playlist_song", { playlistId: item.id, songId: track.source.id });
    reloadLikes(); setRefresh((value) => value + 1);
  }
  const liked = summary?.likedPlaylist;
  const retry = <ActionButton size="sm" variant="ghost" onClick={() => { invalidateMusicLibrary(); setRefresh((value) => value + 1); }}><RefreshCw aria-hidden="true" />重试</ActionButton>;

  return <section className="music-library" aria-label="网易云音乐库">
    {showingDetail ? <>
      <CollectionHeader key={`${collection.kind}:${collection.id}`} collection={collection} description={detail.description} total={detail.total || collection.trackCount} busy={playing} disabled={playing || !profile || detailBusy || !detail.tracks.length} onPlay={() => void playCollection(collection)} />
      {!profile ? <div className="library-empty"><p>登录网易云音乐后查看这个收藏。</p><LoginDialog /></div>
        : detailBusy && !detail.tracks.length ? <p role="status" className="library-empty">正在加载歌曲…</p>
        : detail.tracks.length ? <TrackList tracks={detail.tracks} currentKey={currentKey} busy={playing} onPlay={(index) => playPage(detail.tracks, index)} onAppend={append} removeLabel={collection.kind === "playlist" ? "从歌单删除" : "从列表删除"} onRemove={collection.kind === "playlist" && collection.creatorId === profile.userId ? (track) => removeFromPlaylist(collection, track) : undefined} />
        : <p className="library-empty">这里还没有歌曲。</p>}
      {profile && <InfiniteLoad more={detail.more} busy={detailBusy} error={detailList.error} onLoad={detailList.loadMore} />}
    </> : <>
      <header className="library-profile">
        {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" className="library-avatar" /> : <UserRound className="library-avatar bg-muted p-2" aria-hidden="true" />}
        <h1 className="library-heading">{profile ? `${profile.nickname}的音乐库` : "我的音乐库"}</h1>
      </header>
      {(accountLoading || accountError) && <p role={accountError ? "alert" : "status"} className="mt-4 text-sm text-muted-foreground">{accountError ?? "正在读取账号…"}</p>}
      <div className="library-featured">
        <div className="library-liked-card">
          <button className="library-liked-open" aria-label="打开我喜欢的音乐" disabled={!liked} onClick={() => { if (liked) openCollection({ ...liked, name: "我喜欢的音乐" }); }}>
            <div className="library-liked-top"><LyricExcerpt track={summary?.likedTracks[0]} /></div>
            <div><h2>我喜欢的音乐</h2><p>{summaryBusy ? "正在加载…" : summaryError || summary?.likedError ? "暂时无法读取" : liked ? `${liked.trackCount} 首歌` : profile ? "还没有喜欢的音乐" : "登录后收藏你的音乐"}</p></div>
          </button>
          <ActionButton size="icon-lg" className="library-liked-play" aria-label="播放我喜欢的音乐" disabled={playing || !liked || !summary?.likedTracks.length} onClick={() => { if (liked) void playCollection(liked); }} title="播放收藏（最多 1000 首）"><Play aria-hidden="true" /></ActionButton>
        </div>
        <div className="library-featured-songs">
          {!profile && !accountLoading ? <div className="library-empty"><p>登录网易云音乐，找回你喜欢的旋律。</p><LoginDialog /></div>
            : summaryError || summary?.likedError ? <div role="alert" className="library-empty text-destructive"><p>{summaryError ?? summary?.likedError}</p>{retry}</div>
            : summaryBusy ? <div role="status" className="library-song-grid">{Array.from({ length: 12 }, (_, index) => <div key={index} className="library-song-skeleton"><span /><div><span /><span /></div></div>)}</div>
            : summary?.likedTracks.length ? <div className="library-song-grid">{summary.likedTracks.map((track) => <SongContextMenu key={track.key} track={track} busy={playing} onPlay={() => { if (liked) void playCollection(liked, track.key); }} removeLabel="从歌单删除" onRemove={liked && liked.creatorId === profile?.userId ? () => removeFromPlaylist(liked, track) : undefined} render={<div role="group" onClick={(event) => { if (!playing && liked && !(event.target as HTMLElement).closest("button")) void playCollection(liked, track.key); }} onKeyDown={(event) => { if (!playing && liked && event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); void playCollection(liked, track.key); } }} className="library-song" data-current={track.key === currentKey} title={`${track.title} · ${track.artist}`} />}><button type="button" disabled={playing} aria-label={`播放 ${track.title}`} onClick={() => { if (liked) void playCollection(liked, track.key); }}><Cover cover={track.cover} className="size-10" /></button><div className="min-w-0"><button type="button" className="block max-w-full truncate text-left font-semibold" disabled={playing} onClick={() => { if (liked) void playCollection(liked, track.key); }}><TrackTitle track={track} /></button><p className="truncate text-xs opacity-75"><TrackArtists track={track} /></p></div></SongContextMenu>)}</div>
            : <p className="library-empty text-muted-foreground">喜欢的歌曲会出现在这里。</p>}
        </div>
      </div>
      <div className="library-tabs-row">
        <div className="library-tabs" aria-label="音乐收藏分类">
          <div className="library-playlist-tab" data-active={tab === "playlist"}>
            <ActionButton variant="ghost" className="library-tab" aria-pressed={tab === "playlist"} onClick={() => { setTab("playlist"); }}>{filters.find((item) => item.value === filter)?.label}</ActionButton>
            <Select items={filters} value={filter} onValueChange={(value) => { if (value) { setFilter(value as PlaylistFilter); setTab("playlist"); } }}><SelectTrigger size="sm" aria-label="筛选歌单" className="library-filter-trigger"><span className="sr-only"><SelectValue /></span></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{filters.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
          </div>
          {tabs.slice(1).map((item) => <ActionButton key={item.value} variant="ghost" className="library-tab" data-active={tab === item.value} aria-pressed={tab === item.value} onClick={() => { setTab(item.value); }}>{item.label}</ActionButton>)}
        </div>
        {tab === "playlist" && profile && <CreatePlaylist onCreated={() => { setRefresh((value) => value + 1); }} />}
      </div>
      {tab === "history" && <div className="mb-5 flex gap-2"><ActionButton variant={week ? "secondary" : "ghost"} size="sm" aria-pressed={week} onClick={() => { setWeek(true); }}>最近一周</ActionButton><ActionButton variant={!week ? "secondary" : "ghost"} size="sm" aria-pressed={!week} onClick={() => { setWeek(false); }}>所有时间</ActionButton></div>}
      {!profile ? <p className="library-empty text-muted-foreground">登录后查看收藏的歌单、专辑和艺人。</p>
        : listBusy && !list.items.length ? <div role="status" className="library-cover-grid">{Array.from({ length: 5 }, (_, index) => <div className="library-cover-skeleton" key={index}><span /><span /><span /></div>)}</div>
        : tab === "history" ? history.tracks.length ? <TrackList tracks={history.tracks} busy={playing} currentKey={currentKey} onPlay={(index) => playPage(history.tracks, index)} onAppend={append} /> : <p className="library-empty text-muted-foreground">这段时间还没有听歌记录。</p>
        : collections.items.length ? <CollectionCards items={collections.items} busy={playing} onOpen={openCollection} onPlay={(item) => void playCollection(item)} /> : <p className="library-empty text-muted-foreground">{tab === "playlist" ? "没有符合筛选条件的歌单。" : `还没有收藏${tab === "album" ? "专辑" : "艺人"}。`}</p>}
      {profile && <InfiniteLoad more={list.more} busy={listBusy} error={list.error} onLoad={list.loadMore} />}
    </>}
  </section>;
}
