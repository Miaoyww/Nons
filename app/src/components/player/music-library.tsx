// Layout and interaction adapted from YesPlayMusic src/views/library.vue.
// Copyright (c) 2020-2023 qier222, MIT. See notices/YesPlayMusic-LICENSE.txt.
import { useEffect, useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Heart, Play, Plus, RefreshCw, UserRound } from "lucide-react";
import { errorText, nativeCall, usePlayer, type Lyrics, type Track } from "@/lib/player";
import { getLibraryCollections, getLibraryHistory, getLibraryTracks, getMusicLibrary, playLibraryCollection,
  type CollectionPage, type CollectionTracks, type LibrarySummary, type LibraryTab, type PlaylistFilter } from "@/lib/music-library";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/base/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionButton } from "./action-button";
import { useAccount } from "./account";
import { Cover } from "./cover";
import { LoginDialog } from "./login-dialog";
import { useMusicNavigation, type MusicCollection } from "./music-navigation";
import { TrackList } from "./track-list";

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

function Pagination({ offset, size, more, busy, onChange }: { offset: number; size: number; more: boolean; busy: boolean; onChange: (value: number) => void }) {
  return <div className="library-pagination"><span>第 {Math.floor(offset / size) + 1} 页</span><div className="flex gap-2">
    <ActionButton size="sm" variant="ghost" disabled={busy || offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>上一页</ActionButton>
    <ActionButton size="sm" variant="ghost" disabled={busy || !more} onClick={() => onChange(offset + size)}>下一页</ActionButton>
  </div></div>;
}

function LyricExcerpt({ track }: { track?: Track }) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let disposed = false;
    setLines([]);
    if (!track || !isTauri()) return;
    void nativeCall<Lyrics | null>("track_lyrics", { key: track.key, refresh: false, skipAmll: false, skipLocal: false }).then(async (value) => {
      if (!value || disposed) return;
      const { parseLrc, parseTTML, parseYrc } = await import("@applemusic-like-lyrics/lyric");
      if (disposed) return;
      const lyrics = value.format === "ttml" ? parseTTML(value.content).lines : value.format === "yrc" ? parseYrc(value.content) : parseLrc(value.content);
      const excerpt = lyrics.map((line) => line.words.map((word) => word.word).join("").trim())
        .filter((line) => line && !/作词|作曲|纯音乐|编曲/.test(line));
      const start = Math.floor(Math.random() * Math.max(1, excerpt.length - 2));
      setLines(excerpt.slice(start, start + 3));
    }).catch(() => { /* Optional lyrics never block the collection or playback. */ });
    return () => { disposed = true; };
  }, [track?.key]);
  return lines.length ? <p className="library-lyric-excerpt">{lines.map((line, index) => <span key={index}>{line}<br /></span>)}</p> : <Heart className="size-10 opacity-30" aria-hidden="true" />;
}

function CollectionCards({ items, busy, onOpen, onPlay }: { items: MusicCollection[]; busy: boolean; onOpen: (item: MusicCollection) => void; onPlay: (item: MusicCollection) => void }) {
  return <div className="library-cover-grid">{items.map((item) => <article key={`${item.kind}:${item.id}`} className="library-cover-card">
    <div className="library-cover-art">
      <button className="library-cover-open" onClick={() => onOpen(item)} aria-label={`打开 ${item.name}`}>
        <Cover cover={item.cover} className={`aspect-square w-full ${item.kind === "artist" ? "rounded-full" : "rounded-xl"}`} />
      </button>
      <ActionButton size="icon-lg" className="library-cover-play" disabled={busy} aria-label={`播放 ${item.name}`} title="播放收藏（最多 1000 首）" onClick={() => onPlay(item)}><Play aria-hidden="true" /></ActionButton>
    </div>
    <button className="library-cover-title" onClick={() => onOpen(item)} title={item.name}>{item.name}</button>
    <p className="library-cover-subtitle" title={item.subtitle}>{item.kind === "playlist" && item.subtitle ? "by " : ""}{item.subtitle}</p>
  </article>)}</div>;
}

export default function MusicLibrary({ onError }: { onError: (cause: unknown) => void }) {
  const { profile, loading: accountLoading, error: accountError } = useAccount();
  const { page, navigate } = useMusicNavigation();
  const player = usePlayer();
  const currentKey = player.index !== null ? player.queue[player.index]?.key : undefined;
  const [summary, setSummary] = useState<LibrarySummary>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string>();
  const [tab, setTab] = useState<LibraryTab>("playlist");
  const [filter, setFilter] = useState<PlaylistFilter>("all");
  const [week, setWeek] = useState(true);
  const [offset, setOffset] = useState(0);
  const [collections, setCollections] = useState<CollectionPage>({ items: [], more: false });
  const [history, setHistory] = useState<CollectionTracks>({ tracks: [], total: 0, more: false });
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string>();
  const [detail, setDetail] = useState<CollectionTracks>({ tracks: [], total: 0, more: false });
  const collection = page.collection;
  const [detailPage, setDetailPage] = useState<{ collection?: MusicCollection; offset: number }>({ offset: 0 });
  const detailOffset = detailPage.collection === collection ? detailPage.offset : 0;
  const setDetailOffset = (offset: number) => setDetailPage({ collection, offset });
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const showingDetail = page.view === "collection" && !!collection;

  useEffect(() => {
    let disposed = false;
    setSummary(undefined); setSummaryError(undefined); setSummaryBusy(false); setNotice(undefined);
    if (!profile || !isTauri()) return;
    setSummaryBusy(true);
    void getMusicLibrary().then((value) => { if (!disposed) setSummary(value); })
      .catch((cause) => { if (!disposed) setSummaryError(errorText(cause)); })
      .finally(() => { if (!disposed) setSummaryBusy(false); });
    return () => { disposed = true; };
  }, [profile, refresh]);

  useEffect(() => {
    let disposed = false;
    setCollections({ items: [], more: false }); setHistory({ tracks: [], total: 0, more: false }); setListError(undefined); setListBusy(false);
    if (!profile || !isTauri() || showingDetail) return;
    setListBusy(true);
    const request = tab === "history" ? getLibraryHistory(week, offset).then((value) => { if (!disposed) setHistory(value); })
      : getLibraryCollections(tab, offset, filter).then((value) => { if (!disposed) setCollections(value); });
    void request.catch((cause) => { if (!disposed) setListError(errorText(cause)); })
      .finally(() => { if (!disposed) setListBusy(false); });
    return () => { disposed = true; };
  }, [profile, tab, filter, week, offset, refresh, showingDetail]);

  useEffect(() => {
    let disposed = false;
    setDetail({ tracks: [], total: 0, more: false }); setDetailError(undefined); setDetailBusy(false);
    if (!collection || !profile || !showingDetail || !isTauri()) return;
    setDetailBusy(true);
    void getLibraryTracks(collection, detailOffset).then((value) => { if (!disposed) setDetail(value); })
      .catch((cause) => { if (!disposed) setDetailError(errorText(cause)); })
      .finally(() => { if (!disposed) setDetailBusy(false); });
    return () => { disposed = true; };
  }, [collection, profile, detailOffset, refresh, showingDetail]);

  function openCollection(item: MusicCollection) { navigate("collection", "", item); }
  async function playCollection(item: MusicCollection, key?: string) {
    if (playing) return;
    setPlaying(true); setNotice(undefined);
    try {
      const truncated = await playLibraryCollection(item, key);
      if (truncated) setNotice("已将前 1000 首歌曲加入播放队列。其余歌曲可在收藏详情中分页播放。");
    } catch (cause) { onError(cause); }
    finally { setPlaying(false); }
  }
  function playPage(tracks: Track[], index: number) {
    void nativeCall("play_queue", { keys: tracks.map((track) => track.key), index }).catch(onError);
  }
  function append(track: Track) {
    void nativeCall("append_queue", { keys: [track.key] }).catch(onError);
  }
  const liked = summary?.likedPlaylist;
  const retry = <ActionButton size="sm" variant="ghost" onClick={() => setRefresh((value) => value + 1)}><RefreshCw aria-hidden="true" />重试</ActionButton>;

  return <section className="music-library" aria-label="网易云音乐库">
    {notice && <p role="status" className="mb-4 text-sm text-muted-foreground">{notice}</p>}
    {showingDetail ? <>
      <header className="library-detail-header">
        <Cover cover={collection.cover} className={`aspect-square w-48 ${collection.kind === "artist" ? "rounded-full" : "rounded-2xl"}`} />
        <div className="min-w-0"><p className="mb-2 text-sm text-muted-foreground">{collection.kind === "playlist" ? "歌单" : collection.kind === "album" ? "专辑" : "艺人 · 热门歌曲"}</p><h1 className="library-heading">{collection.name}</h1><p className="mt-3 text-sm text-muted-foreground">{collection.subtitle}{detail.total > 0 ? ` · ${detail.total} 首音乐` : ""}</p><ActionButton className="mt-5" disabled={playing || !profile || detailBusy || !detail.tracks.length} onClick={() => void playCollection(collection)} title="播放收藏（最多 1000 首）"><Play aria-hidden="true" />{playing ? "正在加载…" : "播放"}</ActionButton></div>
      </header>
      {!profile ? <div className="library-empty"><p>登录网易云音乐后查看这个收藏。</p><LoginDialog /></div>
        : detailError ? <div role="alert" className="library-empty text-destructive"><p>{detailError}</p>{retry}</div>
        : detailBusy ? <p role="status" className="library-empty">正在加载歌曲…</p>
        : detail.tracks.length ? <TrackList offset={detailOffset} tracks={detail.tracks} currentKey={currentKey} busy={playing} onPlay={(index) => playPage(detail.tracks, index)} onAppend={append} />
        : <p className="library-empty">这里还没有歌曲。</p>}
      {profile && !detailError && <Pagination offset={detailOffset} size={100} more={detail.more} busy={detailBusy} onChange={setDetailOffset} />}
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
            : summary?.likedTracks.length ? <div className="library-song-grid">{summary.likedTracks.map((track) => <button key={track.key} className="library-song" data-current={track.key === currentKey} disabled={playing} onClick={() => { if (liked) void playCollection(liked, track.key); }} aria-label={`播放 ${track.title}`} title={`${track.title} · ${track.artist}`}><Cover cover={track.cover} className="size-10" /><div className="min-w-0"><p className="truncate font-semibold">{track.title}</p><p className="truncate text-xs opacity-75">{track.artist}</p></div></button>)}</div>
            : <p className="library-empty text-muted-foreground">喜欢的歌曲会出现在这里。</p>}
        </div>
      </div>
      <div className="library-tabs-row">
        <div className="library-tabs" aria-label="音乐收藏分类">
          <div className="library-playlist-tab" data-active={tab === "playlist"}>
            <ActionButton variant="ghost" className="library-tab" aria-pressed={tab === "playlist"} onClick={() => { setTab("playlist"); setOffset(0); }}>{filters.find((item) => item.value === filter)?.label}</ActionButton>
            <Select items={filters} value={filter} onValueChange={(value) => { if (value) { setFilter(value as PlaylistFilter); setTab("playlist"); setOffset(0); } }}><SelectTrigger size="sm" aria-label="筛选歌单" className="library-filter-trigger"><span className="sr-only"><SelectValue /></span></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{filters.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
          </div>
          {tabs.slice(1).map((item) => <ActionButton key={item.value} variant="ghost" className="library-tab" data-active={tab === item.value} aria-pressed={tab === item.value} onClick={() => { setTab(item.value); setOffset(0); }}>{item.label}</ActionButton>)}
        </div>
        {tab === "playlist" && profile && <CreatePlaylist onCreated={() => { setOffset(0); setRefresh((value) => value + 1); }} />}
      </div>
      {tab === "history" && <div className="mb-5 flex gap-2"><ActionButton variant={week ? "secondary" : "ghost"} size="sm" aria-pressed={week} onClick={() => { setWeek(true); setOffset(0); }}>最近一周</ActionButton><ActionButton variant={!week ? "secondary" : "ghost"} size="sm" aria-pressed={!week} onClick={() => { setWeek(false); setOffset(0); }}>所有时间</ActionButton></div>}
      {!profile ? <p className="library-empty text-muted-foreground">登录后查看收藏的歌单、专辑和艺人。</p>
        : listError ? <div role="alert" className="library-empty text-destructive"><p>{listError}</p>{retry}</div>
        : listBusy ? <div role="status" className="library-cover-grid">{Array.from({ length: 5 }, (_, index) => <div className="library-cover-skeleton" key={index}><span /><span /><span /></div>)}</div>
        : tab === "history" ? history.tracks.length ? <TrackList offset={offset} tracks={history.tracks} busy={playing} currentKey={currentKey} onPlay={(index) => playPage(history.tracks, index)} onAppend={append} /> : <p className="library-empty text-muted-foreground">这段时间还没有听歌记录。</p>
        : collections.items.length ? <CollectionCards items={collections.items} busy={playing} onOpen={openCollection} onPlay={(item) => void playCollection(item)} /> : <p className="library-empty text-muted-foreground">{tab === "playlist" ? "这一页没有符合筛选条件的歌单。" : `还没有收藏${tab === "album" ? "专辑" : "艺人"}。`}</p>}
      {profile && !listError && <Pagination offset={offset} size={tab === "history" ? 100 : 30} more={tab === "history" ? history.more : collections.more} busy={listBusy} onChange={setOffset} />}
    </>}
  </section>;
}
