import { useCallback, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Disc3, ListMusic, Mic2, Music2, Search } from "lucide-react";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/animate-ui/components/base/tabs";
import { nativeCall, usePlayer, type Track } from "@/lib/player";
import { usePagedList } from "@/lib/use-paged-list";
import { playLibraryCollection } from "@/features/library/library-api";
import { MusicPage, MusicPageHeader } from "@/components/music/music-page";
import { useMusicNavigation, type MusicCollection } from "@/features/workspace/music-navigation";
import { TrackList } from "@/components/music/track-list";
import { PlaylistCard } from "@/features/library/playlist-card";
import { AlbumCard } from "@/features/library/album-card";
import { InfiniteLoad } from "@/components/music/infinite-load";

const categories = [{ value: "song", label: "单曲", icon: Music2 }, { value: "playlist", label: "歌单", icon: ListMusic }, { value: "artist", label: "歌手", icon: Mic2 }, { value: "album", label: "专辑", icon: Disc3 }] as const;
type SearchKind = typeof categories[number]["value"];

function Results({ kind, keyword, onError, onNotice }: { kind: SearchKind; keyword: string; onError: (cause: unknown) => void; onNotice: (message: string) => void }) {
  const { navigate } = useMusicNavigation();
  const player = usePlayer();
  const [playing, setPlaying] = useState(false);
  const loader = useCallback(async (offset: number) => {
    if (kind === "song") {
      const items = await nativeCall<Track[]>("search_music", { keyword, offset });
      return { items, more: items.length === 50 };
    }
    return nativeCall<{ items: MusicCollection[]; more: boolean }>("search_collections", { keyword, kind, offset });
  }, [keyword, kind]);
  const list = usePagedList<Track | MusicCollection>(loader, kind === "song" ? 50 : 30, isTauri() && !!keyword);
  const tracks = list.items as Track[];
  const currentKey = player.index === null ? undefined : player.queue[player.index]?.key;
  async function playCollection(item: MusicCollection) {
    if (playing) return;
    setPlaying(true);
    try { if (await playLibraryCollection(item)) onNotice("已将前 1000 首歌曲加入播放队列。"); }
    catch (cause) { onError(cause); }
    finally { setPlaying(false); }
  }
  const open = (item: MusicCollection) => navigate("collection", "", item);
  return <>
    {list.items.length ? kind === "song" ? <TrackList tracks={tracks} busy={false} currentKey={currentKey}
      onPlay={index => void nativeCall("play_queue", { keys: tracks.map(track => track.key), index }).catch(onError)}
      onAppend={track => void nativeCall("append_queue", { keys: [track.key] }).then(() => onNotice(`已将「${track.title}」设为下一首播放。`)).catch(onError)} />
      : <div className="discover-playlist-grid">{(list.items as MusicCollection[]).map(item => kind === "album"
        ? <AlbumCard key={item.id} item={item} busy={playing || !isTauri()} onOpen={open} onPlay={item => void playCollection(item)} />
        : <PlaylistCard key={item.id} item={item} busy={playing || !isTauri()} onOpen={open} onPlay={item => void playCollection(item)} />)}</div>
      : !list.error && <div className="search-empty" role="status"><Search className="size-9" aria-hidden="true" /><p>{!isTauri() ? "在桌面应用中搜索音乐" : list.busy ? "正在搜索…" : keyword ? "没有找到匹配结果" : "下一首喜欢的音乐，等你发现"}</p><span>{keyword ? "试试其他关键词，或切换搜索类型。" : "在顶部搜索框输入歌曲、歌手、歌单或专辑名称。"}</span></div>}
    <InfiniteLoad more={list.more} busy={list.busy} error={list.error} onLoad={list.loadMore} />
  </>;
}

export default function SearchPage({ onError, onNotice }: { onError: (cause: unknown) => void; onNotice: (message: string) => void }) {
  const { page } = useMusicNavigation();
  const [kind, setKind] = useState<SearchKind>("song");
  return <MusicPage className="search-page" aria-label="搜索网易云音乐">
    <MusicPageHeader title={page.query || "搜索音乐"}><p>{page.query ? "网易云音乐搜索结果" : "输入歌曲、歌手、歌单或专辑名称开始搜索。"}</p></MusicPageHeader>
    <Tabs value={kind} onValueChange={value => setKind(value as SearchKind)} className="gap-0">
      <div className="music-page-section-bar"><h2>搜索结果</h2><TabsList className="music-tabs" aria-label="搜索结果类型">{categories.map(({ value, label, icon: Icon }) => <TabsTab key={value} value={value}><Icon aria-hidden="true" />{label}</TabsTab>)}</TabsList></div>
      {categories.map(({ value }) => <TabsPanel key={value} value={value} transition={{ duration: 0.15 }}><Results kind={value} keyword={page.query} onError={onError} onNotice={onNotice} /></TabsPanel>)}
    </Tabs>
  </MusicPage>;
}
