type MapInstance = import('maplibre-gl').Map

type PatchableMap = typeof import('maplibre-gl').Map.prototype & { __atlasUiTweaksPatched?: boolean }
type DistrictState = {
  map: MapInstance
  canvas: HTMLCanvasElement | null
  frame: number | null
  listener: (() => void) | null
}

type StyleLayerCandidate = {
  id?: string
  type?: string
  'source-layer'?: string
}

type ProjectableCoordinate = [number, number]
type UnknownGeometry = { type?: unknown, coordinates?: unknown }

const pointLabelLayerId = 'atlas-point-label'
const districtCanvasClassName = 'atlas-district-fog-lines-canvas'
const states = new WeakMap<MapInstance, DistrictState>()

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isProjectableCoordinate(value: unknown): value is ProjectableCoordinate {
  return Array.isArray(value) && value.length >= 2 && finite(value[0]) && finite(value[1])
}

function isDistrictBoundaryLayer(layer: unknown) {
  const candidate = layer as StyleLayerCandidate
  const isBoundaryLine = candidate.type === 'line' && candidate['source-layer'] === 'boundaries'
  const isAdminLine = candidate.type === 'line' && Boolean(candidate.id?.startsWith('admin_'))

  return Boolean(candidate.id) && (isBoundaryLine || isAdminLine)
}

function getState(map: MapInstance) {
  const existing = states.get(map)
  if (existing) return existing

  const state: DistrictState = { map, canvas: null, frame: null, listener: null }
  states.set(map, state)

  return state
}

function ensureDistrictCanvas(state: DistrictState) {
  if (state.canvas) return state.canvas

  const container = state.map.getContainer()
  if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative'

  const canvas = document.createElement('canvas')
  canvas.className = districtCanvasClassName
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '6',
  })

  container.appendChild(canvas)
  state.canvas = canvas

  return canvas
}

function resize(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.round(rect.width * ratio))
  const height = Math.max(1, Math.round(rect.height * ratio))

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  return { ratio, width: rect.width, height: rect.height }
}

function drawLine(context: CanvasRenderingContext2D, map: MapInstance, line: unknown) {
  if (!Array.isArray(line) || line.length < 2) return

  let hasStarted = false
  context.beginPath()

  for (const coordinate of line) {
    if (!isProjectableCoordinate(coordinate)) {
      hasStarted = false
      continue
    }

    const point = map.project(coordinate)

    if (!hasStarted) {
      context.moveTo(point.x, point.y)
      hasStarted = true
    } else {
      context.lineTo(point.x, point.y)
    }
  }

  if (hasStarted) context.stroke()
}

function drawGeometry(context: CanvasRenderingContext2D, map: MapInstance, geometry: UnknownGeometry) {
  if (geometry.type === 'LineString') {
    drawLine(context, map, geometry.coordinates)
    return
  }

  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    geometry.coordinates.forEach((line) => drawLine(context, map, line))
    return
  }

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    geometry.coordinates.forEach((ring) => drawLine(context, map, ring))
    return
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    geometry.coordinates.forEach((polygon) => {
      if (Array.isArray(polygon)) polygon.forEach((ring) => drawLine(context, map, ring))
    })
  }
}

function getDistrictLayerIds(map: MapInstance) {
  return (map.getStyle().layers ?? [])
    .filter(isDistrictBoundaryLayer)
    .map((layer) => (layer as StyleLayerCandidate).id)
    .filter((id): id is string => Boolean(id && map.getLayer(id)))
}

function drawDistrictBoundaries(state: DistrictState) {
  const map = state.map
  const canvas = ensureDistrictCanvas(state)
  const context = canvas.getContext('2d')
  if (!context) return

  const { ratio, width, height } = resize(canvas)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)

  if (!map.isStyleLoaded()) return

  const layers = getDistrictLayerIds(map)
  if (!layers.length) return

  context.scale(ratio, ratio)
  context.save()
  context.strokeStyle = 'rgba(0,0,0,.78)'
  context.lineWidth = 1.1
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const features = map.queryRenderedFeatures({ layers }) as unknown[]
  const seen = new Set<string>()

  for (const feature of features) {
    const geometry = (feature as { geometry?: UnknownGeometry })?.geometry
    if (!geometry) continue

    const key = JSON.stringify(geometry).slice(0, 2000)
    if (seen.has(key)) continue
    seen.add(key)

    drawGeometry(context, map, geometry)
  }

  context.restore()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(canvas.width, 0, Math.max(0, canvas.width - width * ratio), canvas.height)
  context.clearRect(0, canvas.height, canvas.width, Math.max(0, canvas.height - height * ratio))
}

function requestDraw(state: DistrictState) {
  if (state.frame !== null) return

  state.frame = window.requestAnimationFrame(() => {
    state.frame = null
    drawDistrictBoundaries(state)
  })
}

function attachListeners(state: DistrictState) {
  if (state.listener) return

  const redraw = () => requestDraw(state)
  const map = state.map as MapInstance & {
    on: (event: string, listener: () => void) => MapInstance
  }

  for (const event of ['move', 'zoom', 'resize', 'rotate', 'pitch', 'idle', 'styledata', 'sourcedata']) {
    map.on(event, redraw)
  }

  state.listener = redraw
}

function detachListeners(state: DistrictState) {
  if (!state.listener) return

  const map = state.map as MapInstance & {
    off: (event: string, listener: () => void) => MapInstance
  }

  for (const event of ['move', 'zoom', 'resize', 'rotate', 'pitch', 'idle', 'styledata', 'sourcedata']) {
    map.off(event, state.listener)
  }

  state.listener = null
}

function patchMapPrototype(prototype: PatchableMap) {
  if (prototype.__atlasUiTweaksPatched) return
  prototype.__atlasUiTweaksPatched = true

  const originalAddLayer = prototype.addLayer
  prototype.addLayer = function patchedAddLayer(this: MapInstance, ...args: Parameters<MapInstance['addLayer']>) {
    const layer = args[0] as StyleLayerCandidate

    if (layer.id === pointLabelLayerId) {
      return this
    }

    const result = originalAddLayer.apply(this, args)
    const state = getState(this)
    attachListeners(state)

    if (isDistrictBoundaryLayer(layer)) {
      requestDraw(state)
    }

    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    const state = states.get(this)

    if (state) {
      detachListeners(state)
      if (state.frame !== null) window.cancelAnimationFrame(state.frame)
      state.canvas?.remove()
    }

    states.delete(this)

    return originalRemove.call(this)
  }
}

export function installAtlasUiTweaks() {
  return import('maplibre-gl').then((maplibregl) => {
    patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
    console.info('[atlas-ui] tweaks installed {}')
  })
}
