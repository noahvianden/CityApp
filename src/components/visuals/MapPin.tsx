import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { MapPin as DefaultPinIcon } from 'lucide-react'

export type MapPinVariant =
  | 'default'
  | 'current'
  | 'active'
  | 'saved'
  | 'favorite'
  | 'memory'
  | 'private'
  | 'route'
  | 'discovery'
  | 'locked'
  | 'disabled'
  | 'focus'
  | 'compact'

export type MapPinProps = {
  variant?: MapPinVariant
  active?: boolean
  selected?: boolean
  saved?: boolean
  disabled?: boolean
  label: string
  left?: number
  top?: number
  icon?: LucideIcon
  children?: ReactNode
  className?: string
  style?: CSSProperties
  onClick?: () => void
}

function variantClass(variant: MapPinVariant, flags: Pick<MapPinProps, 'active' | 'selected' | 'saved' | 'disabled'>) {
  return [
    'visual-map-pin',
    `visual-map-pin--${variant}`,
    flags.active || flags.selected ? 'is-active' : '',
    flags.saved ? 'is-saved' : '',
    flags.disabled ? 'is-disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function MapPin({
  variant = 'default',
  active = false,
  selected = false,
  saved = false,
  disabled = false,
  label,
  left,
  top,
  icon: Icon = DefaultPinIcon,
  children,
  className = '',
  style,
  onClick,
}: MapPinProps) {
  const positionStyle: CSSProperties = {
    ...(typeof left === 'number' ? { left: `${left}%` } : null),
    ...(typeof top === 'number' ? { top: `${top}%` } : null),
    ...style,
  }
  const content = children ?? <Icon aria-hidden="true" />
  const classes = `${variantClass(variant, { active, selected, saved, disabled })} ${className}`.trim()

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        style={positionStyle}
        aria-label={label}
        aria-pressed={active || selected}
        disabled={disabled}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }

  return (
    <span className={classes} style={positionStyle} role="img" aria-label={label} aria-disabled={disabled || undefined}>
      {content}
    </span>
  )
}

export default MapPin
