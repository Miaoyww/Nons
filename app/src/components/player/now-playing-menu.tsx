import { Menu } from "@base-ui/react/menu";
import { Ellipsis, Heart, Info, RefreshCw, Share2 } from "lucide-react";
import { ActionButton } from "./action-button";

export function NowPlayingMenu({ disabled, source }: { disabled: boolean; source?: string }) {
  return <Menu.Root>
    <Menu.Trigger disabled={disabled} render={<ActionButton variant="ghost" size="icon-sm" aria-label="歌曲菜单" title="歌曲菜单" />}>
      <Ellipsis aria-hidden="true" />
    </Menu.Trigger>
    <Menu.Portal><Menu.Positioner className="z-[70]" side="bottom" align="end" sideOffset={6}>
      <Menu.Popup className="song-context-menu" aria-label="歌曲菜单">
        <Menu.Item disabled><Heart aria-hidden="true" />收藏歌曲</Menu.Item>
        <Menu.Item disabled><Share2 aria-hidden="true" />分享歌曲</Menu.Item>
        <Menu.Item disabled><Info aria-hidden="true" />歌曲详情</Menu.Item>
        <Menu.Separator />
        <Menu.Item disabled title={`歌词来源：${source ?? "暂无歌词"}`}><RefreshCw aria-hidden="true" />刷新歌词</Menu.Item>
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
