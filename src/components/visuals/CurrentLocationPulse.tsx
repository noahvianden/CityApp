export type CurrentLocationPulseProps = {
  cx: number
  cy: number
  moving?: boolean
  visible?: boolean
  className?: string
}

export function CurrentLocationPulse({ cx, cy, moving = false, visible = true, className = '' }: CurrentLocationPulseProps) {
  if (!visible) {
    return null
  }

  return (
    <g className={`visual-current-location ${moving ? 'is-moving' : ''} ${className}`.trim()} aria-label="Current location">
      <circle className="visual-current-location__halo" cx={cx} cy={cy} r="22" />
      <circle className="visual-current-location__dot" cx={cx} cy={cy} r="9" />
    </g>
  )
}

export default CurrentLocationPulse
