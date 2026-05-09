import type { LucideIcon } from 'lucide-react'
import { MapPin } from 'lucide-react'
import type { Category } from '../../cityprintData'

export type PlaceBadgeTone = 'green' | 'sage' | 'blue' | 'coral' | 'slate' | 'gold'

export type PlaceBadgeProps = {
  category?: Category
  tone?: PlaceBadgeTone
  icon?: LucideIcon
  label: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const categoryTone: Partial<Record<Category, PlaceBadgeTone>> = {
  cafe: 'green',
  restaurant: 'coral',
  park: 'sage',
  bar: 'blue',
  gallery: 'slate',
  shop: 'green',
  culture: 'slate',
  viewpoint: 'gold',
  market: 'blue',
  quiet_spot: 'sage',
  landmark: 'slate',
}

export function PlaceBadge({
  category,
  tone = category ? categoryTone[category] ?? 'green' : 'green',
  icon: Icon = MapPin,
  label,
  size = 'md',
  className = '',
}: PlaceBadgeProps) {
  return (
    <span
      className={`visual-place-badge visual-place-badge--${tone} visual-place-badge--${size} ${className}`.trim()}
      role="img"
      aria-label={label}
      data-category={category}
    >
      <Icon aria-hidden="true" />
    </span>
  )
}

export default PlaceBadge
