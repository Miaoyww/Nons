import type { ComponentProps, CSSProperties } from 'react'

type PlayerSliderProps = Omit<ComponentProps<'input'>, 'type' | 'min' | 'max' | 'value'> & {
  min?: number
  max: number
  value: number
}

export function PlayerSlider({
  min = 0,
  max,
  value,
  className = '',
  style,
  ...props
}: PlayerSliderProps) {
  const progress = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      value={value}
      className={`player-slider ${className}`}
      style={{ ...style, '--slider-progress': `${progress * 100}%` } as CSSProperties}
    />
  )
}
