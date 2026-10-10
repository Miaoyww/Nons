import { useRef } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { AudioLines } from '@/components/animate-ui/icons/audio-lines'
import { usePlayer } from '@/lib/player'

export function PlayingIndicator() {
  const { status } = usePlayer()
  const host = useRef<HTMLSpanElement>(null)
  const visible = useInView(host)
  const reducedMotion = useReducedMotion()
  const playing = status === 'playing'
  return (
    <span
      ref={host}
      className="inline-flex shrink-0 items-center justify-center text-[var(--music-accent)]"
      role="img"
      aria-label={playing ? '正在播放' : '当前曲目'}
      title={playing ? '正在播放' : '当前曲目'}
    >
      <AudioLines size={18} animate={playing && visible && !reducedMotion} aria-hidden="true" />
    </span>
  )
}
