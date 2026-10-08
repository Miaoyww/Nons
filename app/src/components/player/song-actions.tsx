import { PlaylistPicker } from "./playlist-picker";
import { ContextMenu } from "@base-ui/react/context-menu";
import { ChevronRight, Copy, FolderPlus, Heart, Info, ListPlus, Play, Share2, Trash2 } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { nativeCall, formatTime, errorText, type Track } from "@/lib/player";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "@/components/animate-ui/components/base/dialog";
import { ActionButton } from "./action-button";
import { useAccount } from "./account";

interface SongInformation { artists: { name: string; id: number | null }[]; albumId: number | null; publishedAt: number | null }
export function songLink(track: Track) {
  const id = track.source.kind === "netease" ? track.source.id : track.source.neteaseId;
  return id ? `https://music.163.com/#/song?id=${id}` : "";
}
export function songCopyName(track: Track) { return `${track.title} - ${track.artist}`; }

const SongActionsContext = createContext<{
  collect: (track: Track) => void; details: (track: Track) => void; run: (operation: () => void | Promise<unknown>, notice?: string) => void; copy: (text: string) => void;
} | null>(null);

export function SongActionsProvider({ children, onError, onNotice }: { children: ReactNode; onError: (error: unknown) => void; onNotice: (message: string) => void }) {
  const [collectTrack, setCollectTrack] = useState<Track>();
  const [track, setTrack] = useState<Track>();
  const [information, setInformation] = useState<SongInformation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [copyMessage, setCopyMessage] = useState<string>();
  const copying = useRef(false);
  useEffect(() => {
    let disposed = false;
    setInformation(undefined); setError(undefined); setCopyMessage(undefined); setBusy(!!track && isTauri());
    if (track && isTauri()) void nativeCall<SongInformation>("song_information", { key: track.key, refresh: retry > 0 })
      .then((value) => { if (!disposed) setInformation(value); })
      .catch((cause) => { if (!disposed) setError(errorText(cause)); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [track, retry]);
  function run(operation: () => void | Promise<unknown>, notice?: string) {
    void Promise.resolve().then(operation).then(() => { if (notice) onNotice(notice); }).catch(onError);
  }
  async function copy(text: string) {
    if (!text || copying.current) return;
    copying.current = true;
    try { await navigator.clipboard.writeText(text); setCopyMessage("已复制"); onNotice("已复制到剪贴板。"); }
    catch (cause) { setCopyMessage("复制失败，请重试"); onError(cause); }
    finally { copying.current = false; }
  }
  const fields = track ? [
    ["歌曲名称", track.title],
    ["歌手", information?.artists.map((artist) => artist.name).join(" / ") || track.artist],
    ["歌手 ID", information?.artists.map((artist) => artist.id ?? "未知").join(" / ") ?? ""],
    ["专辑", track.album], ["专辑 ID", information?.albumId?.toString() ?? ""],
    ["歌曲 ID", (track.source.kind === "netease" ? track.source.id : track.source.neteaseId)?.toString() ?? ""],
    ["时长", formatTime(track.durationMs)],
    ["发行时间", information?.publishedAt ? new Date(information.publishedAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) : ""],
    ["歌曲链接", songLink(track)],
  ] : [];
  function field(index: number) {
    const [label, value] = fields[index];
    return <div className="song-information-field" key={label}><label htmlFor={`song-information-${index}`}>{label}</label><div><input id={`song-information-${index}`} readOnly value={value || "未知"} /><ActionButton variant="ghost" size="icon-sm" aria-label={`复制${label}`} disabled={!value} onClick={() => void copy(value)}><Copy aria-hidden="true" /></ActionButton></div></div>;
  }
  return <SongActionsContext.Provider value={{ collect: setCollectTrack, details: (value) => { setRetry(0); setTrack(value); }, run, copy: (text) => { void copy(text); } }}>
    {children}
    <PlaylistPicker track={collectTrack} onClose={() => setCollectTrack(undefined)} onNotice={onNotice} />
    <Dialog open={!!track} onOpenChange={(open) => { if (!open) setTrack(undefined); }}>
      <DialogPopup className="song-information-dialog">
        <DialogTitle>歌曲详情复制</DialogTitle><DialogDescription>查看歌曲信息，点击复制按钮复制单项或全部信息。</DialogDescription>
        {track && <>
          {field(0)}
          <h3 className="song-information-divider">制作人员</h3>
          <div className="song-information-grid">{[1, 2, 3, 4].map(field)}</div>
          <h3 className="song-information-divider">歌曲信息</h3>
          <div className="song-information-grid">{[5, 6].map(field)}</div>
          {field(7)}{field(8)}
          {busy && <p role="status" className="text-sm text-muted-foreground">正在读取更多信息…</p>}
          {error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><span>{error}</span><ActionButton variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>重试</ActionButton></div>}
          <p role="status" className="sr-only">{copyMessage}</p>
          <ActionButton variant="secondary" className="w-full" onClick={() => void copy(fields.map(([label, value]) => `${label}：${value || "未知"}`).join("\n"))}>复制全部信息</ActionButton>
        </>}
      </DialogPopup>
    </Dialog>
  </SongActionsContext.Provider>;
}

export function SongContextMenu({ track, render, children, onPlay, busy = false, onRemove, removeLabel = "从列表删除" }: {
  track: Track; render: ReactElement; children: ReactNode; onPlay: () => void; busy?: boolean; onRemove?: () => void | Promise<unknown>; removeLabel?: string;
}) {
  const actions = useContext(SongActionsContext);
  const { profile, likedIds, likesReady, pendingLikes, toggleLike } = useAccount();
  if (!actions) throw new Error("SongActionsProvider is required");
  const id = track.source.kind === "netease" ? track.source.id : undefined;
  const liked = id !== undefined && likedIds.has(id);
  const unavailable = busy || !isTauri();
  return <ContextMenu.Root>
    <ContextMenu.Trigger render={render} tabIndex={0}>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Positioner className="z-[70]" sideOffset={4}><ContextMenu.Popup className="song-context-menu" aria-label={`${track.title} 的歌曲菜单`}>
      {!unavailable && <ContextMenu.Item onClick={() => actions.run(onPlay)}><Play aria-hidden="true" />播放</ContextMenu.Item>}
      {!unavailable && <ContextMenu.Item onClick={() => actions.run(() => nativeCall("append_queue", { keys: [track.key] }), `已将「${track.title}」设为下一首播放。`)}><ListPlus aria-hidden="true" />下一首播放</ContextMenu.Item>}
      {!unavailable && id !== undefined && profile && likesReady && !pendingLikes.has(id) && <ContextMenu.Item onClick={() => { if (id !== undefined) actions.run(() => toggleLike(id)); }}><Heart aria-hidden="true" />{liked ? "取消收藏" : "收藏"}</ContextMenu.Item>}
      {!unavailable && <ContextMenu.Separator />}
      {!unavailable && profile && songLink(track) && <ContextMenu.Item onClick={() => actions.collect(track)}><FolderPlus aria-hidden="true" />收藏到歌单</ContextMenu.Item>}
      <ContextMenu.SubmenuRoot><ContextMenu.SubmenuTrigger><Share2 aria-hidden="true" />分享<ChevronRight className="ml-auto" aria-hidden="true" /></ContextMenu.SubmenuTrigger>
        <ContextMenu.Portal><ContextMenu.Positioner className="z-[71]" sideOffset={4}><ContextMenu.Popup className="song-context-menu">
          {songLink(track) && <ContextMenu.Item onClick={() => actions.copy(songLink(track))}><Copy aria-hidden="true" />复制歌曲链接</ContextMenu.Item>}
          <ContextMenu.Item onClick={() => actions.copy(songCopyName(track))}><Copy aria-hidden="true" />复制歌曲名称</ContextMenu.Item>
          <ContextMenu.Item onClick={() => actions.details(track)}><Info aria-hidden="true" />更多信息</ContextMenu.Item>
        </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
      </ContextMenu.SubmenuRoot>
      {onRemove && !unavailable && <ContextMenu.Item className="song-menu-remove" onClick={() => { if (onRemove) actions.run(onRemove, "已移除歌曲。"); }}><Trash2 aria-hidden="true" />{removeLabel}</ContextMenu.Item>}
    </ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>;
}
