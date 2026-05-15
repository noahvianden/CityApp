type MapInstance = import('maplibre-gl').Map

type PatchableMap = typeof import('maplibre-gl').Map.prototype & { __atlasUiTweaksPatched?: boolean }
type StyleLayerCandidate = {
  id?: string
  type?: string
  source?: string
  'source-layer'?: string
  filter?: unknown
  minzoom?: number
}

type ZoomRangeMap = MapInstance & {
  setLayerZoomRange?: (layerId: string, minzoom: number, maxzoom: number) => MapInstance
}

const pointLabelLayerId = 'atlas-point-label'
const closeRoadLabelZoom = 15.5

function isHighwayOrAutobahnLabel(layer: StyleLayerCandidate) {
  if (layer.type !== 'symbol' || layer['source-layer'] !== 'roads') return false

  const id = layer.id?.toLowerCase() ?? ''
  const filterText = JSON.stringify(layer.filter ?? '').toLowerCase()
  const isRoadText = id.includes('label') || id.includes('shield') || id.includes('exit') || id.includes('route')
  const isHighway =
    filterText.includes('motorway') ||
    filterText.includes('trunk') ||
    id.includes('motorway') ||
    id.includes('highway') ||
    id.includes('shield')

  return isRoadText && isHighway
}

function tuneHighwayLabels(map: MapInstance) {
  if (!map.isStyleLoaded()) return

  const zoomRangeMap = map as ZoomRangeMap
  for (const layer of map.getStyle().layers ?? []) {
    const candidate = layer as StyleLayerCandidate

    if (!candidate.id || !map.getLayer(candidate.id) || !isHighwayOrAutobahnLabel(candidate)) {
      continue
    }

    try {
      zoomRangeMap.setLayerZoomRange?.(candidate.id, Math.max(candidate.minzoom ?? 0, closeRoadLabelZoom), 24)
    } catch {
      // Third-party style layers can reject dynamic zoom range changes on some renderers.
    }
  }
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

    if (isHighwayOrAutobahnLabel(layer)) {
      layer.minzoom = Math.max(layer.minzoom ?? 0, closeRoadLabelZoom)
    }

    const result = originalAddLayer.apply(this, args)
    tuneHighwayLabels(this)

    return result
  }

  const originalSetStyle = prototype.setStyle
  prototype.setStyle = function patchedSetStyle(this: MapInstance, ...args: Parameters<MapInstance['setStyle']>) {
    const result = originalSetStyle.apply(this, args)
    window.setTimeout(() => tuneHighwayLabels(this), 0)
    return result
  }
}

export function installAtlasUiTweaks() {
  return import('maplibre-gl').then((maplibregl) => {
    patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
    console.info('[atlas-ui] tweaks installed {}')
  })
}
