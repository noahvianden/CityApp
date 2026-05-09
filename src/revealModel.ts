import type { City, Place } from './cityprintData'

export type MapCell = {
  id: string
  x: number
  y: number
  left: number
  top: number
}

export type FogState = 'hidden' | 'partial' | 'recent' | 'revealed'

export const mapColumns = 7
export const mapRows = 8

export const mapCells: MapCell[] = Array.from({ length: mapColumns * mapRows }, (_, index) => {
  const x = index % mapColumns
  const y = Math.floor(index / mapColumns)

  return {
    id: `${x}-${y}`,
    x,
    y,
    left: (x + 0.5) * (100 / mapColumns),
    top: (y + 0.5) * (100 / mapRows),
  }
})

export function cellDistance(a: string, b: string) {
  const [ax, ay] = a.split('-').map(Number)
  const [bx, by] = b.split('-').map(Number)

  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

export function revealAround(cellId: string, radius = 1) {
  return mapCells.filter((cell) => cellDistance(cell.id, cellId) <= radius).map((cell) => cell.id)
}

export function classifyFogCell(cellId: string, revealedCells: ReadonlySet<string>, recentCells: ReadonlySet<string>): FogState {
  if (recentCells.has(cellId)) {
    return 'recent'
  }

  if (revealedCells.has(cellId)) {
    return 'revealed'
  }

  const isPartial = mapCells.some((cell) => revealedCells.has(cell.id) && cellDistance(cell.id, cellId) <= 1)

  return isPartial ? 'partial' : 'hidden'
}

export function getVisiblePlaces<TPlace extends Pick<Place, 'cell' | 'id'>>(
  places: TPlace[],
  revealedCells: ReadonlySet<string>,
  hiddenPlaceIds: ReadonlySet<string> = new Set(),
) {
  return places.filter((place) => revealedCells.has(place.cell) && !hiddenPlaceIds.has(place.id))
}

export function toRoutePoint(cellId: string) {
  const cell = mapCells.find((candidate) => candidate.id === cellId)

  if (!cell) {
    return '0,0'
  }

  return `${cell.left * 7},${cell.top * 8}`
}

export type WalkRevealInput = {
  city: Pick<City, 'places' | 'walkRoute'>
  routeIndex: number
  revealedCells: ReadonlySet<string>
  seenPlaceIds: ReadonlySet<string>
}

export type WalkRevealResult = {
  nextIndex: number
  nextRevealedCells: Set<string>
  newlyRevealedCells: string[]
  newPlaceIds: string[]
  nextSeenPlaceIds: Set<string>
  shouldPauseForDiscovery: boolean
  isComplete: boolean
}

export function advanceWalkReveal({ city, routeIndex, revealedCells, seenPlaceIds }: WalkRevealInput): WalkRevealResult {
  if (routeIndex >= city.walkRoute.length - 1) {
    return {
      nextIndex: routeIndex,
      nextRevealedCells: new Set(revealedCells),
      newlyRevealedCells: [],
      newPlaceIds: [],
      nextSeenPlaceIds: new Set(seenPlaceIds),
      shouldPauseForDiscovery: false,
      isComplete: true,
    }
  }

  const nextIndex = routeIndex + 1
  const nextCell = city.walkRoute[nextIndex]
  const nextRevealedCells = new Set(revealedCells)
  const newlyRevealedCells = revealAround(nextCell).filter((cellId) => !nextRevealedCells.has(cellId))

  newlyRevealedCells.forEach((cellId) => nextRevealedCells.add(cellId))

  const newPlaceIds = city.places
    .filter((place) => nextRevealedCells.has(place.cell) && !seenPlaceIds.has(place.id))
    .map((place) => place.id)
  const nextSeenPlaceIds = new Set([...seenPlaceIds, ...newPlaceIds])

  return {
    nextIndex,
    nextRevealedCells,
    newlyRevealedCells,
    newPlaceIds,
    nextSeenPlaceIds,
    shouldPauseForDiscovery: newPlaceIds.length > 0,
    isComplete: nextIndex >= city.walkRoute.length - 1,
  }
}
