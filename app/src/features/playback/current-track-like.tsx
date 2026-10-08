import { Heart } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import type { Track } from '@/lib/player'
import { Button } from '@/components/ui/button'
import { useAccount } from '@/features/account/account'

export function CurrentTrackLike({
  track,
  onError
}: {
  track?: Track
  onError: (error: unknown) => void
}) {
  const { profile, likedIds, likesReady, pendingLikes, toggleLike } = useAccount()
  const songId = track?.source.kind === 'netease' ? track.source.id : undefined
  const liked = songId !== undefined && likedIds.has(songId)
  const likePending = songId !== undefined && pendingLikes.has(songId)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="playback-like"
      aria-label={liked ? '取消收藏当前歌曲' : '收藏当前歌曲'}
      aria-pressed={liked}
      aria-busy={likePending}
      title={
        !track
          ? '选择一首音乐后收藏'
          : songId === undefined
            ? '本地歌曲暂不支持网易云收藏'
            : !profile
              ? '登录后收藏歌曲'
              : !likesReady
                ? '正在读取收藏状态'
                : liked
                  ? '取消收藏'
                  : '收藏'
      }
      disabled={!isTauri() || songId === undefined || !profile || !likesReady || likePending}
      onClick={() => {
        if (songId !== undefined) void toggleLike(songId).catch(onError)
      }}
    >
      <Heart aria-hidden="true" />
    </Button>
  )
}
