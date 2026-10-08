import { BackgroundRender, MeshGradientRenderer } from '@applemusic-like-lyrics/core'
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { useCoverImageSource } from '@/components/music/use-cover-source'
import { useLyricsSettings } from '@/features/lyrics/use-lyrics-settings'

export function AlbumBackground({
  cover,
  playing,
  hasLyrics
}: {
  cover?: string
  playing: boolean
  hasLyrics: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const renderer = useRef<BackgroundRender<MeshGradientRenderer> | null>(null)
  const reduced = useReducedMotion()
  const { backgroundSpeed } = useLyricsSettings()
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden')
  const { source: album, onError } = useCoverImageSource(cover, visible)
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => {
    if (!host.current || !album || !visible) return
    let background: BackgroundRender<MeshGradientRenderer> | undefined
    try {
      background = BackgroundRender.new(MeshGradientRenderer)
      background.setFPS(30)
      background.setRenderScale(0.5)
      const element = background.getElement()
      element.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
      host.current.appendChild(element)
      renderer.current = background
      const active = background
      void active.setAlbum(album).catch(() => {
        if (renderer.current !== active) return
        active.dispose()
        renderer.current = null
        background = undefined
      })
    } catch {
      background?.dispose()
      background = undefined
      renderer.current = null
    }
    return () => {
      background?.dispose()
      renderer.current = null
    }
  }, [album, visible])
  useEffect(() => {
    const background = renderer.current
    if (!background) return
    background.setFlowSpeed(backgroundSpeed)
    background.setHasLyric(hasLyrics)
    background.setStaticMode(!!reduced)
    if (visible && playing && !reduced) background.resume()
    else background.pause()
  }, [album, visible, playing, reduced, hasLyrics, backgroundSpeed])
  return (
    <div
      className="album-background pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {album && (
        <img
          src={album}
          alt=""
          onError={onError}
          className="absolute size-full scale-125 object-cover opacity-70 blur-3xl"
        />
      )}
      <div ref={host} className="absolute inset-0" />
      <div className="album-background-scrim absolute inset-0" />
    </div>
  )
}
