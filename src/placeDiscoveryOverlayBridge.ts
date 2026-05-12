type MapInstance = import('maplibre-gl').Map

type Coordinate = [number, number]
type LivePlaceCategory = 'cafe' | 'restaurant' | 'bar' | 'gallery' | 'culture' | 'viewpoint' | 'market' | 'park' | 'shop' | 'landmark'
type PatchableMap = typeof import('maplibre-gl').Map.prototype & { __cityPlaceDiscoveryOverlayPatched?: boolean }
type PlaceFeature = {
  geometry?: { type?: unknown, coordinates?: unknown }
  properties?: Record<string, unknown>
}
type PlaceLayerEvent = {
  features?: PlaceFeature[]
  preventDefault?: () => void
}
type LayerEventMap = {
  on: (event: string, layerId: string, listener: (event: PlaceLayerEvent) => void) => void
  off: (event: string, layerId: string, listener: (event: PlaceLayerEvent) => void) => void
  getCanvas: () => HTMLCanvasElement
}
type InstalledHandlers = {
  click: (event: PlaceLayerEvent) => void
  enter: () => void
  leave: () => void
}
type PlaceState = {
  savedIds: string[]
  visitedIds: string[]
  memoryIds: string[]
}
type ReverseAddressPayload = {
  address?: Record<string, string | undefined>
  display_name?: string
}
type PlaceCardModel = {
  id: string
  name: string
  category: LivePlaceCategory
  detail: string
  coordinate: Coordinate
  distanceLabel: string
  tags: string[]
  googleMapsUrl: string
  addressLabel: string
}

const livePlacesCircleLayerId = 'atlas-live-world-places-circle'
const livePlacesLabelLayerId = 'atlas-live-world-places-label'
const placeStateStorageKey = 'cityapp:place-discovery-card-state:v1'
const addressCache = new Map<string, string>()
const installedMaps = new WeakSet<MapInstance>()
const installedHandlers = new WeakMap<MapInstance, InstalledHandlers>()
let overlayRoot: HTMLElement | null = null
let currentPlace: PlaceCardModel | null = null
let installPromise: Promise<void> | null = null

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 && finite(value[0]) && finite(value[1])
}

function stringProperty(properties: Record<string, unknown> | undefined, key: string, fallback = '') {
  const value = properties?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function categoryProperty(properties: Record<string, unknown> | undefined): LivePlaceCategory {
  const value = stringProperty(properties, 'category')
  if (
    value === 'cafe'
    || value === 'restaurant'
    || value === 'bar'
    || value === 'gallery'
    || value === 'culture'
    || value === 'viewpoint'
    || value === 'market'
    || value === 'park'
    || value === 'shop'
    || value === 'landmark'
  ) {
    return value
  }

  return 'landmark'
}

function titleCase(value: string) {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getCategoryLabel(category: LivePlaceCategory) {
  const labels: Record<LivePlaceCategory, string> = {
    cafe: 'Cafe',
    restaurant: 'Food',
    bar: 'Bar',
    gallery: 'Gallery',
    culture: 'Culture',
    viewpoint: 'View',
    market: 'Market',
    park: 'Park',
    shop: 'Shop',
    landmark: 'Landmark',
  }
  return labels[category]
}

function getCategoryTags(category: LivePlaceCategory, detail: string) {
  const tagGroups: Record<LivePlaceCategory, string[]> = {
    cafe: ['cozy', 'coffee', 'quiet'],
    restaurant: ['food', 'social', 'nearby'],
    bar: ['evening', 'social', 'local'],
    gallery: ['art', 'indoors', 'recap safe'],
    culture: ['culture', 'curious', 'indoors'],
    viewpoint: ['scenic', 'photo stop', 'open air'],
    market: ['local', 'browse', 'busy'],
    park: ['scenic', 'quiet', 'fresh air'],
    shop: ['local', 'browse', 'quick stop'],
    landmark: ['notable', 'recap safe', 'cityprint'],
  }

  const tags = [...tagGroups[category]]
  const normalizedDetail = detail.toLocaleLowerCase()
  if (normalizedDetail && !tags.includes(normalizedDetail) && normalizedDetail.length <= 18) tags.unshift(normalizedDetail)
  return tags.slice(0, 6)
}

function metersBetween(a: { lng: number, lat: number }, b: { lng: number, lat: number }) {
  const earth = 6_371_000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const latA = a.lat * Math.PI / 180
  const latB = b.lat * Math.PI / 180
  const sLat = Math.sin(dLat / 2)
  const sLng = Math.sin(dLng / 2)
  const h = sLat * sLat + Math.cos(latA) * Math.cos(latB) * sLng * sLng
  return 2 * earth * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(1 - h, 0)))
}

function formatDistance(meters: number) {
  if (!Number.isFinite(meters)) return 'nearby'
  if (meters < 90) return 'right here'
  if (meters < 950) return `${Math.round(meters / 10) * 10} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

function getGoogleMapsUrl(place: Pick<PlaceCardModel, 'name' | 'coordinate'>) {
  const [lng, lat] = place.coordinate
  const query = encodeURIComponent(`${place.name} ${lat},${lng}`)
  return `https://www.google.com/maps/search/?api=1&query=${query}`
}

function getCoordinateAddressCacheKey([lng, lat]: Coordinate) {
  return `${lat.toFixed(6)}:${lng.toFixed(6)}`
}

function readAddressPart(address: Record<string, string | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = address[key]?.trim()
    if (value) return value
  }
  return ''
}

function formatAddress(payload: ReverseAddressPayload) {
  const address = payload.address ?? {}
  const street = readAddressPart(address, ['road', 'pedestrian', 'footway', 'path', 'cycleway', 'residential'])
  const houseNumber = readAddressPart(address, ['house_number'])
  const postcode = readAddressPart(address, ['postcode'])
  const streetLine = [street, houseNumber].filter(Boolean).join(' ')

  if (streetLine && postcode) return `${streetLine} · ${postcode}`
  if (streetLine) return streetLine
  if (postcode) return postcode

  return 'Street address unavailable'
}

async function lookupAddressLabel(place: PlaceCardModel) {
  const [lng, lat] = place.coordinate
  const cacheKey = getCoordinateAddressCacheKey(place.coordinate)
  const cached = addressCache.get(cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'en',
  })

  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })

  if (!response.ok) return 'Street address unavailable'

  const payload = await response.json() as ReverseAddressPayload
  const label = formatAddress(payload)
  addressCache.set(cacheKey, label)
  return label
}

function featureToPlaceModel(map: MapInstance, feature: PlaceFeature): PlaceCardModel | null {
  const coordinate = feature.geometry?.type === 'Point' && isCoordinate(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : null
  if (!coordinate) return null

  const properties = feature.properties
  const name = stringProperty(properties, 'name', 'Discovered place')
  const category = categoryProperty(properties)
  const detail = titleCase(stringProperty(properties, 'detail', getCategoryLabel(category)))
  const center = map.getCenter()
  const distanceLabel = formatDistance(metersBetween({ lng: center.lng, lat: center.lat }, { lng: coordinate[0], lat: coordinate[1] }))
  const addressLabel = addressCache.get(getCoordinateAddressCacheKey(coordinate)) ?? 'Looking up street address...'
  const basePlace = {
    id: stringProperty(properties, 'id', `${coordinate[1]}:${coordinate[0]}:${name}`),
    name,
    category,
    detail,
    coordinate,
    distanceLabel,
    addressLabel,
    tags: getCategoryTags(category, detail),
  }

  return { ...basePlace, googleMapsUrl: getGoogleMapsUrl(basePlace) }
}

function getPlaceState(): PlaceState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(placeStateStorageKey) ?? '{}')
    return {
      savedIds: Array.isArray(parsed.savedIds) ? parsed.savedIds.filter((entry: unknown): entry is string => typeof entry === 'string') : [],
      visitedIds: Array.isArray(parsed.visitedIds) ? parsed.visitedIds.filter((entry: unknown): entry is string => typeof entry === 'string') : [],
      memoryIds: Array.isArray(parsed.memoryIds) ? parsed.memoryIds.filter((entry: unknown): entry is string => typeof entry === 'string') : [],
    }
  } catch {
    return { savedIds: [], visitedIds: [], memoryIds: [] }
  }
}

function setPlaceState(state: PlaceState) {
  try {
    window.localStorage.setItem(placeStateStorageKey, JSON.stringify({
      savedIds: Array.from(new Set(state.savedIds)),
      visitedIds: Array.from(new Set(state.visitedIds)),
      memoryIds: Array.from(new Set(state.memoryIds)),
    }))
  } catch {
    // Place card state is optional convenience UI.
  }
}

function toggleStateId(key: keyof PlaceState, id: string) {
  const state = getPlaceState()
  const currentIds = state[key]
  state[key] = currentIds.includes(id) ? currentIds.filter((entry) => entry !== id) : [...currentIds, id]
  setPlaceState(state)
}

function addStateId(key: keyof PlaceState, id: string) {
  const state = getPlaceState()
  if (!state[key].includes(id)) state[key] = [...state[key], id]
  setPlaceState(state)
}

function ensureOverlayStyles() {
  if (document.getElementById('city-place-discovery-card-styles')) return
  const style = document.createElement('style')
  style.id = 'city-place-discovery-card-styles'
  style.textContent = placeCardStyles
  document.head.appendChild(style)
}

function ensureOverlayRoot() {
  ensureOverlayStyles()
  if (overlayRoot?.isConnected) return overlayRoot
  overlayRoot = document.createElement('section')
  overlayRoot.className = 'city-place-discovery-card-shell'
  overlayRoot.setAttribute('aria-live', 'polite')
  overlayRoot.hidden = true
  document.body.appendChild(overlayRoot)
  return overlayRoot
}

function renderGoogleOverlay(place: PlaceCardModel) {
  return `
    <button class="city-place-google-overlay" type="button" data-place-action="maps">
      <span class="city-place-mini-map" aria-hidden="true">
        <span class="city-place-mini-road horizontal"></span>
        <span class="city-place-mini-road vertical"></span>
        <span class="city-place-mini-water"></span>
        <span class="city-place-mini-park"></span>
        <span class="city-place-mini-pin"></span>
      </span>
      <span class="city-place-google-copy">
        <strong>Google Maps</strong>
        <small>${escapeHtml(place.addressLabel)}</small>
        <em>Open in Google Maps</em>
      </span>
    </button>
  `
}

function renderPlaceCard(place: PlaceCardModel) {
  const state = getPlaceState()
  const isSaved = state.savedIds.includes(place.id)
  const isVisited = state.visitedIds.includes(place.id)
  const hasMemory = state.memoryIds.includes(place.id)
  const root = ensureOverlayRoot()
  root.hidden = false
  root.innerHTML = `
    <article class="city-place-discovery-card" aria-label="Information for ${escapeHtml(place.name)}">
      <button class="city-place-card-close" type="button" data-place-action="close" aria-label="Close place information">×</button>
      <header>
        <h2>${escapeHtml(place.name)}</h2>
        <p>${escapeHtml(getCategoryLabel(place.category))} · ${escapeHtml(place.detail)}</p>
      </header>
      <div class="city-place-card-tags" aria-label="Place tags">
        ${place.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
      </div>
      ${renderGoogleOverlay(place)}
      <div class="city-place-card-actions">
        <button class="city-place-card-primary" type="button" data-place-action="save">${isSaved ? 'Saved' : 'Save'}</button>
        <button class="city-place-card-secondary" type="button" data-place-action="visited">${isVisited ? 'Visited ✓' : 'Visited'}</button>
        <button class="city-place-card-secondary" type="button" data-place-action="memory">${hasMemory ? 'Memory added' : 'Add memory'}</button>
      </div>
    </article>
  `
}

function openGoogleMaps(place: PlaceCardModel) {
  window.open(place.googleMapsUrl, '_blank', 'noopener,noreferrer')
}

function handleOverlayClick(event: MouseEvent) {
  const actionElement = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-place-action]')
  if (!actionElement || !currentPlace) return

  const action = actionElement.dataset.placeAction
  if (action === 'close') {
    if (overlayRoot) overlayRoot.hidden = true
    return
  }

  if (action === 'maps') openGoogleMaps(currentPlace)
  if (action === 'save') toggleStateId('savedIds', currentPlace.id)
  if (action === 'visited') toggleStateId('visitedIds', currentPlace.id)
  if (action === 'memory') addStateId('memoryIds', currentPlace.id)

  renderPlaceCard(currentPlace)
}

function updatePlaceAddress(place: PlaceCardModel) {
  void lookupAddressLabel(place)
    .then((addressLabel) => {
      if (!currentPlace || currentPlace.id !== place.id) return
      currentPlace = { ...currentPlace, addressLabel }
      renderPlaceCard(currentPlace)
    })
    .catch(() => {
      if (!currentPlace || currentPlace.id !== place.id) return
      currentPlace = { ...currentPlace, addressLabel: 'Street address unavailable' }
      renderPlaceCard(currentPlace)
    })
}

function showPlaceCard(map: MapInstance, feature: PlaceFeature) {
  const place = featureToPlaceModel(map, feature)
  if (!place) return

  currentPlace = place
  renderPlaceCard(place)
  updatePlaceAddress(place)
  overlayRoot?.removeEventListener('click', handleOverlayClick)
  overlayRoot?.addEventListener('click', handleOverlayClick)
}

function installMapHandlers(map: MapInstance) {
  if (installedMaps.has(map) || !map.getLayer(livePlacesCircleLayerId)) return
  installedMaps.add(map)

  const layerMap = map as unknown as LayerEventMap
  const click = (event: PlaceLayerEvent) => {
    const feature = event.features?.[0]
    if (!feature) return
    event.preventDefault?.()
    showPlaceCard(map, feature)
  }
  const enter = () => {
    layerMap.getCanvas().style.cursor = 'pointer'
  }
  const leave = () => {
    layerMap.getCanvas().style.cursor = ''
  }

  installedHandlers.set(map, { click, enter, leave })
  layerMap.on('click', livePlacesCircleLayerId, click)
  layerMap.on('click', livePlacesLabelLayerId, click)
  layerMap.on('mouseenter', livePlacesCircleLayerId, enter)
  layerMap.on('mouseenter', livePlacesLabelLayerId, enter)
  layerMap.on('mouseleave', livePlacesCircleLayerId, leave)
  layerMap.on('mouseleave', livePlacesLabelLayerId, leave)
}

function uninstallMapHandlers(map: MapInstance) {
  const handlers = installedHandlers.get(map)
  if (!handlers) return
  const layerMap = map as unknown as LayerEventMap
  layerMap.off('click', livePlacesCircleLayerId, handlers.click)
  layerMap.off('click', livePlacesLabelLayerId, handlers.click)
  layerMap.off('mouseenter', livePlacesCircleLayerId, handlers.enter)
  layerMap.off('mouseenter', livePlacesLabelLayerId, handlers.enter)
  layerMap.off('mouseleave', livePlacesCircleLayerId, handlers.leave)
  layerMap.off('mouseleave', livePlacesLabelLayerId, handlers.leave)
  installedHandlers.delete(map)
}

function patchMapPrototype(prototype: PatchableMap) {
  if (prototype.__cityPlaceDiscoveryOverlayPatched) return
  prototype.__cityPlaceDiscoveryOverlayPatched = true

  const originalAddLayer = prototype.addLayer
  prototype.addLayer = function patchedAddLayer(this: MapInstance, ...args: Parameters<MapInstance['addLayer']>) {
    const result = originalAddLayer.apply(this, args)
    const layer = args[0] as { id?: unknown }
    if (layer.id === livePlacesCircleLayerId || layer.id === livePlacesLabelLayerId) installMapHandlers(this)
    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    uninstallMapHandlers(this)
    return originalRemove.call(this)
  }
}

export function installPlaceDiscoveryOverlayBridge() {
  if (!installPromise) {
    installPromise = import('maplibre-gl').then((maplibregl) => {
      patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
      console.info('[atlas-place-info] click cards installed')
    })
  }
  return installPromise
}

const placeCardStyles = `
.city-place-discovery-card-shell {
  bottom: calc(88px + env(safe-area-inset-bottom));
  left: 18px;
  max-width: 360px;
  position: fixed;
  right: 18px;
  z-index: 220;
}
.city-place-discovery-card-shell[hidden] { display: none; }
.city-place-discovery-card {
  background: #fff8ed;
  border: 1px solid rgba(70, 45, 18, .12);
  border-radius: 24px;
  box-shadow: 0 24px 60px rgba(42, 34, 24, .2);
  color: #2d2a25;
  display: grid;
  gap: 12px;
  padding: 19px 18px 16px;
  position: relative;
}
.city-place-card-close {
  align-items: center;
  background: rgba(45, 42, 37, .08);
  border: 0;
  border-radius: 999px;
  color: rgba(45, 42, 37, .72);
  display: flex;
  font: inherit;
  font-size: 19px;
  font-weight: 900;
  height: 30px;
  justify-content: center;
  line-height: 1;
  position: absolute;
  right: 12px;
  top: 12px;
  width: 30px;
}
.city-place-discovery-card h2 {
  font-size: 25px;
  font-weight: 950;
  letter-spacing: -.045em;
  line-height: 1;
  margin: 0 34px 4px 0;
}
.city-place-discovery-card header p {
  color: #2a9b73;
  font-size: 12px;
  font-weight: 900;
  margin: 0;
}
.city-place-google-overlay {
  align-items: center;
  background: #fffaf4;
  border: 1px solid rgba(70, 45, 18, .12);
  border-radius: 20px;
  box-shadow: 0 10px 26px rgba(42, 34, 24, .14);
  color: inherit;
  display: grid;
  gap: 12px;
  grid-template-columns: 78px minmax(0, 1fr);
  min-height: 72px;
  padding: 10px;
  text-align: left;
}
.city-place-mini-map {
  background: #e8f1ed;
  border-radius: 14px;
  display: block;
  height: 52px;
  overflow: hidden;
  position: relative;
}
.city-place-mini-road,
.city-place-mini-water,
.city-place-mini-park,
.city-place-mini-pin { position: absolute; }
.city-place-mini-road { background: rgba(255, 255, 255, .9); border-radius: 999px; height: 8px; width: 86px; }
.city-place-mini-road.horizontal { left: -7px; top: 28px; transform: rotate(-8deg); }
.city-place-mini-road.vertical { height: 74px; left: 31px; top: -14px; transform: rotate(82deg); width: 7px; }
.city-place-mini-water { background: #bfe5ed; border-radius: 999px; bottom: 6px; height: 9px; left: 4px; width: 34px; }
.city-place-mini-park { background: #cfe8cf; border-radius: 999px; height: 17px; right: 8px; top: 6px; width: 31px; }
.city-place-mini-pin { background: #ed4e45; border: 3px solid #fffaf4; border-radius: 999px; height: 14px; left: 34px; top: 22px; width: 14px; }
.city-place-google-copy { display: grid; gap: 3px; min-width: 0; }
.city-place-google-copy strong { color: #2d2a25; font-size: 13px; font-weight: 950; }
.city-place-google-copy small { color: #8a8175; font-size: 11px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.city-place-google-copy em {
  align-items: center;
  background: #2d2a25;
  border-radius: 999px;
  color: #fff8ed;
  display: inline-flex;
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
  height: 25px;
  justify-content: center;
  margin-top: 2px;
  max-width: 146px;
  padding: 0 12px;
}
.city-place-card-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.city-place-card-tags span {
  background: #fffaf4;
  border: 1px solid rgba(70, 45, 18, .13);
  border-radius: 999px;
  color: #72695e;
  font-size: 11px;
  font-weight: 900;
  min-width: 62px;
  padding: 7px 10px;
  text-align: center;
}
.city-place-card-actions { display: grid; gap: 10px; grid-template-columns: 1fr 1fr 1.25fr; }
.city-place-card-primary,
.city-place-card-secondary {
  border-radius: 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 950;
  min-height: 42px;
  padding: 0 10px;
}
.city-place-card-primary { background: #2d2a25; border: 0; color: #fff8ed; }
.city-place-card-secondary { background: transparent; border: 1px solid rgba(70, 45, 18, .16); color: #5f574d; }
.city-place-discovery-card button { cursor: pointer; }
.city-place-discovery-card button:focus-visible { outline: 3px solid rgba(217, 101, 79, .38); outline-offset: 2px; }
@media (min-width: 760px) {
  .city-place-discovery-card-shell { left: 28px; right: auto; width: 360px; }
}
@media (max-height: 700px) {
  .city-place-discovery-card-shell { bottom: calc(76px + env(safe-area-inset-bottom)); }
  .city-place-discovery-card { gap: 10px; padding: 15px; }
  .city-place-google-overlay { min-height: 64px; }
}
`
