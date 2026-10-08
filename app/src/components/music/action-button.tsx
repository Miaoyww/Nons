import { useReducedMotion } from 'motion/react'
import { Button, type ButtonProps } from '@/components/animate-ui/components/buttons/button'

export function ActionButton(props: ButtonProps) {
  const reduced = useReducedMotion()
  return <Button type="button" hoverScale={1} tapScale={reduced ? 1 : 0.98} {...props} />
}
