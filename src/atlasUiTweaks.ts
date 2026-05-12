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
const cityLoadingClassName = 'atlas-city-loading-screen'
let isCityLoadingInstalled = false
let hideCityLoadingTimeout: number | null = null
let lastObservedCityTitle = ''

function isHighwayOrAutobahnLabel(layer: StyleLayerCandidate) {
  if (layer.type !== 'symbol' || layer['source-layer'] !== 'roads') return false

  const id = layer.id?.toLowerCase() ?? ''
  const filterText = JSON.stringify(layer.filter ?? '').toLowerCase()
  const isRoadText = id.includes('label') || id.includes('shield') || id.includes('exit') || id.includes('route')
  const isHighway = filterText.includes('motorway') || filterText.includes('trunk') || id.includes('motorway') || id.includes('highway') || id.includes('shield')

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

function getActiveCityTitle() {
  return document.querySelector<HTMLElement>('.atlas-city-title-button span')?.textContent?.trim() ?? ''
}

function ensureCityLoadingScreen() {
  const existing = document.querySelector<HTMLElement>(`.${cityLoadingClassName}`)
  if (existing) return existing

  const loading = document.createElement('div')
  loading.className = cityLoadingClassName
  loading.setAttribute('role', 'status')
  loading.setAttribute('aria-live', 'polite')
  loading.setAttribute('aria-hidden', 'true')
  loading.innerHTML = '<span></span><strong>Loading city</strong><small>Preparing the atlas…</small>'
  document.body.appendChild(loading)

  return loading
}

function hideCityLoadingScreen() {
  if (hideCityLoadingTimeout !== null) {
    window.clearTimeout(hideCityLoadingTimeout)
    hideCityLoadingTimeout = null
  }

  const loading = ensureCityLoadingScreen()
  loading.classList.remove('is-visible')
  loading.setAttribute('aria-hidden', 'true')
  document.body.classList.remove('atlas-city-is-loading')
}

function showCityLoadingScreen(label = 'Loading city') {
  const loading = ensureCityLoadingScreen()
  const title = loading.querySelector('strong')
  if (title && title.textContent !== label) title.textContent = label

  lastObservedCityTitle = getActiveCityTitle()
  loading.classList.add('is-visible')
  loading.setAttribute('aria-hidden', 'false')
  document.body.classList.add('atlas-city-is-loading')

  if (hideCityLoadingTimeout !== null) {
    window.clearTimeout(hideCityLoadingTimeout)
  }

  hideCityLoadingTimeout = window.setTimeout(hideCityLoadingScreen, 4200)
}

function installCityLoadingScreen() {
  if (isCityLoadingInstalled || typeof document === 'undefined') return
  isCityLoadingInstalled = true

  ensureCityLoadingScreen()
  lastObservedCityTitle = getActiveCityTitle()

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    const cityOption = target?.closest('.atlas-city-option')

    if (cityOption && !target?.closest('.atlas-city-favorite-button')) {
      showCityLoadingScreen('Loading city')
    }
  }, true)

  document.addEventListener('submit', (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null

    if (form?.classList.contains('atlas-city-search') && form.dataset.atlasAllowSwitch === 'true') {
      showCityLoadingScreen('Loading city')
    }
  }, true)

  const observer = new MutationObserver(() => {
    const nextTitle = getActiveCityTitle()

    if (nextTitle && lastObservedCityTitle && nextTitle !== lastObservedCityTitle) {
      window.setTimeout(hideCityLoadingScreen, 450)
    }

    if (nextTitle) lastObservedCityTitle = nextTitle
  })

  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
}

export function installAtlasUiTweaks() {
  installCityLoadingScreen()

  return import('maplibre-gl').then((maplibregl) => {
    patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
    console.info('[atlas-ui] tweaks installed {}')
  })
}
