import { useEffect, useRef, useState } from 'react'
import { Button, useCoverSource, usePluginEvent, type PluginSong } from '@app/plugin-sdk'

export function DynamicIsland() {
  const detected = usePluginEvent<PluginSong>('song-detected')
  const [song, setSong] = useState<PluginSong>()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const last = useRef<{ id: number; time: number } | undefined>(undefined)
  const remaining = useRef({ id: 0, ms: 8000 })
  const dismiss = () => {
    setSong(undefined)
    setHovered(false)
    setFocused(false)
  }
  useEffect(() => {
    if (!detected || (last.current?.id === detected.id && Date.now() - last.current.time < 30000))
      return
    last.current = { id: detected.id, time: Date.now() }
    remaining.current = { id: detected.id, ms: 8000 }
    setSong(detected)
  }, [detected])
  useEffect(() => {
    if (!song || paused) return
    const start = performance.now()
    const timer = window.setTimeout(dismiss, remaining.current.ms)
    return () => {
      window.clearTimeout(timer)
      if (remaining.current.id === song.id)
        remaining.current.ms = Math.max(0, remaining.current.ms - (performance.now() - start))
    }
  }, [song, paused])
  const cover = useCoverSource(song?.cover, !!song)
  if (!song) return null
  return (
    <div
      className="nons-island"
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          dismiss()
        }
      }}
    >
      <style>{`.nons-island{pointer-events:auto;display:flex;align-items:center;gap:14px;width:min(420px,calc(100vw - 32px));padding:14px 16px;border:1px solid var(--border);border-radius:28px;background:var(--background);color:var(--foreground);box-shadow:0 12px 40px #0002;animation:nons-island-enter .25s ease-out}.nons-island-cover{width:52px;height:52px;flex-shrink:0;object-fit:cover;border-radius:14px;background:var(--muted)}.nons-island-text{min-width:0;flex:1}.nons-island-text p{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nons-island-label{font-size:11px;color:var(--muted-foreground);margin-bottom:4px!important}.nons-island-title{font-size:14px;font-weight:600}.nons-island-artist{margin-top:3px!important;font-size:12px;color:var(--muted-foreground)}@keyframes nons-island-enter{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.nons-island{animation:none}}`}</style>
      {cover ? (
        <img className="nons-island-cover" src={cover} alt={`${song.title} 封面`} />
      ) : (
        <div className="nons-island-cover" aria-hidden="true" />
      )}
      <div className="nons-island-text">
        <p className="nons-island-label">发现网易云歌曲分享</p>
        <p className="nons-island-title" title={song.title}>
          {song.title}
        </p>
        <p className="nons-island-artist" title={song.artist}>
          {song.artist}
        </p>
      </div>
      <Button variant="ghost" size="icon" aria-label="关闭歌曲预览" onClick={dismiss}>
        ×
      </Button>
    </div>
  )
}
