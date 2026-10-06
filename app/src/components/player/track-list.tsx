import { ListPlus, Play } from "lucide-react";
import { memo } from "react";
import { formatTime, type Track } from "@/lib/player";
import { ActionButton } from "./action-button";
import { Cover } from "./cover";

interface Props { tracks: Track[]; currentKey?: string; busy: boolean; onPlay: (index: number) => void; onAppend?: (track: Track) => void }

export const TrackList = memo(function TrackList({ tracks, currentKey, busy, onPlay, onAppend }: Props) {
  return <table className="w-full table-fixed text-left text-sm">
    <caption className="sr-only">歌曲列表</caption>
    <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground">
      <tr className="border-b border-border"><th className="w-12 py-3 text-center" scope="col">播放</th><th className="py-3" scope="col">歌曲</th><th className="w-[22%] py-3" scope="col">专辑</th><th className="w-20 py-3" scope="col">时长</th>{onAppend && <th className="w-12" scope="col"><span className="sr-only">加入队列</span></th>}</tr>
    </thead>
    <tbody>
      {tracks.map((track, index) => <tr key={`${track.key}:${index}`} className={`group border-b border-border/40 hover:bg-muted/50 ${track.key === currentKey ? "bg-secondary/70" : ""}`}>
        <td className="text-center"><ActionButton variant="ghost" size="icon-sm" disabled={busy} aria-label={`播放 ${track.title}`} onClick={() => onPlay(index)}><Play className="size-3.5" aria-hidden="true" /></ActionButton></td>
        <td className="py-3 pr-4"><div className="flex min-w-0 items-center gap-3"><Cover cover={track.cover} className="size-10" /><div className="min-w-0"><p className="truncate font-medium" title={track.title}>{track.title}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={track.artist}>{track.artist}{track.source.kind === "local" && <span className="ml-2">· 本地</span>}</p></div></div></td>
        <td className="truncate pr-4 text-muted-foreground" title={track.album}>{track.album}</td><td className="tabular-nums text-muted-foreground">{formatTime(track.durationMs)}</td>
        {onAppend && <td><ActionButton variant="ghost" size="icon-sm" disabled={busy} aria-label={`将 ${track.title} 加入队列`} onClick={() => onAppend(track)}><ListPlus aria-hidden="true" /></ActionButton></td>}
      </tr>)}
    </tbody>
  </table>;
});
