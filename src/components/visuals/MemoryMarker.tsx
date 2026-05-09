import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BookOpen, Lock, Route } from 'lucide-react'

export type MemoryMarkerVariant = 'place' | 'route' | 'private'

export type MemoryMarkerProps = {
  variant?: MemoryMarkerVariant
  label: string
  left?: number
  top?: number
  icon?: LucideIcon
  active?: boolean
  className?: string
  style?: CSSProperties
  onClick?: () => void
}

function defaultIconForVariant(variant: MemoryMarkerVariant) {
  if (variant === 'route') {
    return Route
  }

  if (variant === 'private') {
    return Lock
  }

  return BookOpen
}

export function MemoryMarker({
  variant = 'place',
  label,
  left,
  top,
  icon,
  active = false,
  className = '',
  style,
  onClick,
}: MemoryMarkerProps) {
  const Icon = icon ?? defaultIconForVariant(variant)
  const positionStyle: CSSProperties = {
    ...(typeof left === 'number' ? { left: `${left}%` } : null),
    ...(typeof top === 'number' ? { top: `${top}%` } : null),
    ...style,
  }
  const classes = `visual-memory-marker visual-memory-marker--${variant} ${active ? 'is-active' : ''} ${className}`.trim()

  if (onClick) {
    return (
      <button type="button" className={classes} style={positionStyle} aria-label={label} aria-pressed={active} onClick={onClick}>
        <Icon aria-hidden="true" />
      </button>
    )
  }

  return (
    <span className={classes} style={positionStyle} role="img" aria-label={label}>
      <Icon aria-hidden="true" />
    </span>
  )
}

export default MemoryMarker
