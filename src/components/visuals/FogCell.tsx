export type FogCellState = 'hidden' | 'partial' | 'recent' | 'revealed'

export type FogCellProps = {
  d: string
  state: FogCellState
  cellId?: string
  className?: string
}

export function FogCell({ d, state, cellId, className = '' }: FogCellProps) {
  return <path className={`visual-fog-cell visual-fog-cell--${state} ${className}`.trim()} d={d} data-cell-id={cellId} aria-hidden="true" />
}

export default FogCell
