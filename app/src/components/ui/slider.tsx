import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { cn } from 'cn'
import type { CSSProperties } from 'react'

type SliderProps = SliderPrimitive.Root.Props & {
  /** Color of the filled track. Accepts any CSS color, including CSS variables. */
  rangeColor?: CSSProperties['color']
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  rangeColor = 'var(--music-accent)',
  ...props
}: SliderProps) {
  const values = value ?? defaultValue ?? min
  const thumbCount = Array.isArray(values) ? values.length : 1

  return (
    <SliderPrimitive.Root
      className={cn('group/slider data-horizontal:w-full data-vertical:h-full', className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-4xl bg-muted select-none data-horizontal:h-3 data-horizontal:w-full data-vertical:h-full data-vertical:w-3"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="select-none data-horizontal:h-full data-vertical:w-full"
            style={{ backgroundColor: rangeColor }}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            index={index}
            className="block size-4 shrink-0 rounded-4xl border bg-white opacity-0 shadow-sm ring-ring/50 transition-[opacity,box-shadow] select-none group-hover/slider:opacity-100 hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none motion-reduce:transition-none"
            style={{ borderColor: rangeColor }}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider, type SliderProps }
