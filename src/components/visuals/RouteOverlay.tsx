export type RouteOverlayProps = {
  path: string
  visible?: boolean
  active?: boolean
  className?: string
}

export function RouteOverlay({ path, visible = true, active = true, className = '' }: RouteOverlayProps) {
  if (!path || !visible) {
    return null
  }

  return <path className={`visual-route-overlay ${active ? 'is-active' : ''} ${className}`.trim()} d={path} aria-hidden="true" />
}

export default RouteOverlay
