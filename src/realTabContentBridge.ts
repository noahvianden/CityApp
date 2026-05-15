import { getAtlasFogSnapshot, getAtlasFogVisible, setAtlasFogVisible } from './atlasGeoFogBridge'
import { isCoordinate, isFiniteNumber, type Coordinate } from './geoSpatial'

type LivePlaceCategory = 'cafe' | 'restaurant' | 'bar' | 'gallery' | 'culture' | 'viewpoint' | 'market' | 'park' | 'shop' | 'landmark'
type SavedPlace = {
  id: string
  name: string
  category: LivePlaceCategory
  detail: string
  coordinate: Coordinate
  addressLabel: string
  googleMapsUrl: string
  savedAt: number
}
type RealTabKey = 'memories' | 'stats' | 'privacy'
type StoredPlaceState = {
  savedIds: string[]
  visitedIds: string[]
  memoryIds: string[]
  savedPlaces: SavedPlace[]
}

const placeStateStorageKey = 'cityapp:place-discovery-card-state:v1'
let isInstalled = false
let intervalId: number | null = null
let observer: MutationObserver | null = null
let pendingFrame = 0

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function categoryProperty(value: unknown): LivePlaceCategory {
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
  ) return value
  return 'landmark'
}

function isSavedPlace(value: unknown): value is SavedPlace {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<SavedPlace>
  return (
    typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.detail === 'string'
    && isCoordinate(entry.coordinate)
    && typeof entry.addressLabel === 'string'
    && typeof entry.googleMapsUrl === 'string'
    && isFiniteNumber(entry.savedAt)
  )
}

function dedupeSavedPlaces(places: SavedPlace[]) {
  const seen = new Set<string>()
  return places
    .map((place) => ({ ...place, category: categoryProperty(place.category) }))
    .filter((place) => {
      if (seen.has(place.id)) return false
      seen.add(place.id)
      return true
    })
    .sort((a, b) => b.savedAt - a.savedAt)
}

function getPlaceState(): StoredPlaceState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(placeStateStorageKey) ?? '{}')
    return {
      savedIds: readStringArray(parsed.savedIds),
      visitedIds: readStringArray(parsed.visitedIds),
      memoryIds: readStringArray(parsed.memoryIds),
      savedPlaces: Array.isArray(parsed.savedPlaces) ? dedupeSavedPlaces(parsed.savedPlaces.filter(isSavedPlace)) : [],
    }
  } catch {
    return { savedIds: [], visitedIds: [], memoryIds: [], savedPlaces: [] }
  }
}

function setPlaceState(state: StoredPlaceState) {
  const savedIds = Array.from(new Set(state.savedIds))
  const savedIdSet = new Set(savedIds)
  const savedPlaces = dedupeSavedPlaces(state.savedPlaces.filter((place) => savedIdSet.has(place.id)))

  try {
    window.localStorage.setItem(placeStateStorageKey, JSON.stringify({
      savedIds,
      visitedIds: Array.from(new Set(state.visitedIds)),
      memoryIds: Array.from(new Set(state.memoryIds)),
      savedPlaces,
    }))
  } catch {
    // Optional UI storage.
  }
}

function getActiveCityName() {
  return document.querySelector<HTMLElement>('.atlas-city-title-button span')?.textContent?.trim() || 'Current city'
}

function getActiveTabKey(): RealTabKey | null {
  const activeTab = document.querySelector<HTMLElement>('.atlas-tab.active')
  const text = activeTab?.textContent?.replace(/\s+/g, ' ').trim().toLocaleLowerCase() ?? ''

  if (text.includes('memories')) return 'memories'
  if (text.includes('stats')) return 'stats'
  if (text.includes('privacy')) return 'privacy'

  return null
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

function formatSavedAt(savedAt: number) {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return 'Saved place'
  return `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

function metric(label: string, value: string, note?: string) {
  return `
    <div class="city-real-tab-metric">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      ${note ? `<small>${escapeHtml(note)}</small>` : ''}
    </div>
  `
}

function card(title: string, body: string, accent?: string) {
  return `
    <div class="city-real-tab-card ${accent ? `accent-${accent}` : ''}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </div>
  `
}

function actionButton(label: string, action: string, isActive = false) {
  return `<button class="city-real-tab-action ${isActive ? 'active' : ''}" type="button" data-real-tab-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`
}

function savedPlaceItem(place: SavedPlace) {
  return `
    <article class="city-saved-place-item" data-saved-place-id="${escapeHtml(place.id)}">
      <button class="city-saved-place-main" type="button" data-real-tab-action="open-saved-place" data-place-id="${escapeHtml(place.id)}">
        <span class="city-saved-place-pin ${escapeHtml(place.category)}" aria-hidden="true"></span>
        <span class="city-saved-place-copy">
          <strong>${escapeHtml(place.name)}</strong>
          <small>${escapeHtml(getCategoryLabel(place.category))} · ${escapeHtml(place.detail)}</small>
          <em>${escapeHtml(place.addressLabel || 'Address unavailable')}</em>
        </span>
        <span class="city-saved-place-date">${escapeHtml(formatSavedAt(place.savedAt))}</span>
      </button>
      <button class="city-saved-place-remove" type="button" data-real-tab-action="remove-saved-place" data-place-id="${escapeHtml(place.id)}" aria-label="Remove ${escapeHtml(place.name)} from saved places">×</button>
    </article>
  `
}

function savedPlacesList(savedPlaces: SavedPlace[]) {
  if (!savedPlaces.length) {
    return `
      <div class="city-saved-places-empty">
        <strong>No saved places yet</strong>
        <span>Tap a live place on Atlas, then press Save. Saved places will appear here with address details and quick map access.</span>
      </div>
    `
  }

  return `
    <div class="city-saved-places-list" aria-label="Saved places">
      ${savedPlaces.map(savedPlaceItem).join('')}
    </div>
  `
}

function memoryContent(placeState: StoredPlaceState) {
  const savedPlaces = placeState.savedPlaces
  const savedCount = Math.max(placeState.savedIds.length, savedPlaces.length)
  const visitedCount = placeState.visitedIds.length
  const memoryCount = placeState.memoryIds.length

  return `
    <div class="city-real-tab-header">
      <span>Memories</span>
      <div role="heading" aria-level="2">Saved places</div>
      <small>${escapeHtml(getActiveCityName())} · places you saved from live discovery cards</small>
    </div>
    <div class="city-real-tab-metrics">
      ${metric('saved places', String(savedCount), savedPlaces.length ? 'listed below' : 'from place cards')}
      ${metric('visited places', String(visitedCount), 'marked by you')}
      ${metric('memories', String(memoryCount), 'kept for later')}
    </div>
    ${savedPlacesList(savedPlaces)}
    <div class="city-real-tab-card-list">
      ${card(
        savedPlaces.length ? 'Saved place list' : 'Start your list',
        savedPlaces.length
          ? `${pluralize(savedPlaces.length, 'place')} saved. Tap a row to open it in Google Maps, or remove it with ×.`
          : 'Your saved place list is built from live places on the Atlas map.',
        'warm',
      )}
    </div>
  `
}

function statsContent(placeState: StoredPlaceState) {
  const snapshot = getAtlasFogSnapshot()
  const totalPlaceActions = placeState.savedIds.length + placeState.visitedIds.length + placeState.memoryIds.length

  return `
    <div class="city-real-tab-header">
      <span>Stats</span>
      <div role="heading" aria-level="2">Discovery progress</div>
      <small>${escapeHtml(getActiveCityName())} · updates as fog reveal and place discovery change</small>
    </div>
    <div class="city-real-tab-metrics">
      ${metric('revealed', `${snapshot.progress}%`, snapshot.revealedPoints ? 'city fog progress' : 'start walking to reveal')}
      ${metric('reveal points', String(snapshot.revealedPoints), 'live atlas samples')}
      ${metric('place actions', String(totalPlaceActions), 'saved, visited, memories')}
    </div>
    <div class="city-real-tab-card-list">
      ${card(
        'Map coverage',
        snapshot.revealedPoints
          ? 'The revealed area grows from your live position and simulated route moves inside the active city boundary.'
          : 'Use GPS or Simulated mode on Atlas to begin revealing city coverage.',
        'green',
      )}
      ${card(
        'Live places',
        'Nearby cafes, parks, shops, culture spots, landmarks, and viewpoints appear when the map is zoomed into discovery range.',
      )}
    </div>
  `
}

function privacyContent() {
  const isFogVisible = getAtlasFogVisible()

  return `
    <div class="city-real-tab-header">
      <span>Privacy</span>
      <div role="heading" aria-level="2">Location controls</div>
      <small>Cityprint uses location for the atlas view, fog reveal, and nearby place discovery.</small>
    </div>
    <div class="city-real-tab-metrics">
      ${metric('location mode', 'Manual start', 'GPS starts only from Atlas')}
      ${metric('fog layer', isFogVisible ? 'Visible' : 'Hidden', 'you control this')}
      ${metric('route sharing', 'Off', 'no public trail feed')}
    </div>
    <div class="city-real-tab-card-list">
      ${card(
        'What stays local',
        'Saved, visited, and memory actions are stored on this device for the app experience.',
        'blue',
      )}
      ${card(
        'What location is used for',
        'Live location powers the current dot, boundary switching, fog reveal, and nearby place lookups while you are using Atlas.',
      )}
    </div>
    <div class="city-real-tab-actions">
      ${actionButton(isFogVisible ? 'Hide fog' : 'Show fog', 'toggle-fog', isFogVisible)}
      ${actionButton('Back to Atlas', 'atlas')}
    </div>
  `
}

function getPanelSignature(tabKey: RealTabKey) {
  const state = getPlaceState()
  const snapshot = getAtlasFogSnapshot()
  return JSON.stringify({
    tabKey,
    city: getActiveCityName(),
    saved: state.savedIds.length,
    savedPlaces: state.savedPlaces.map((place) => `${place.id}:${place.savedAt}:${place.addressLabel}`).join('|'),
    visited: state.visitedIds.length,
    memories: state.memoryIds.length,
    progress: snapshot.progress,
    revealedPoints: snapshot.revealedPoints,
    fog: getAtlasFogVisible(),
  })
}

function getPanelContent(tabKey: RealTabKey) {
  const placeState = getPlaceState()

  if (tabKey === 'memories') return memoryContent(placeState)
  if (tabKey === 'stats') return statsContent(placeState)
  return privacyContent()
}

function renderRealTabPanel() {
  pendingFrame = 0
  const tabKey = getActiveTabKey()
  const panel = document.querySelector<HTMLElement>('.atlas-dummy-panel')
  if (!tabKey || !panel) return

  const signature = getPanelSignature(tabKey)
  if (panel.dataset.realTabKey === tabKey && panel.dataset.realTabSignature === signature) return

  panel.dataset.realTabKey = tabKey
  panel.dataset.realTabSignature = signature
  panel.classList.add('city-real-tab-panel')
  panel.setAttribute('aria-label', tabKey)
  panel.innerHTML = getPanelContent(tabKey)
}

function scheduleRenderRealTabPanel() {
  if (!pendingFrame) pendingFrame = window.requestAnimationFrame(renderRealTabPanel)
}

function getSavedPlace(id: string) {
  return getPlaceState().savedPlaces.find((place) => place.id === id)
}

function removeSavedPlace(id: string) {
  const state = getPlaceState()
  setPlaceState({
    ...state,
    savedIds: state.savedIds.filter((entry) => entry !== id),
    savedPlaces: state.savedPlaces.filter((place) => place.id !== id),
  })
  scheduleRenderRealTabPanel()
}

function openSavedPlace(id: string) {
  const place = getSavedPlace(id)
  if (!place) return
  window.open(place.googleMapsUrl, '_blank', 'noopener,noreferrer')
}

function handleRealTabAction(event: MouseEvent) {
  const actionElement = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-real-tab-action]')
  if (!actionElement) return

  const action = actionElement.dataset.realTabAction
  const placeId = actionElement.dataset.placeId

  if (action === 'toggle-fog') {
    setAtlasFogVisible(!getAtlasFogVisible())
    scheduleRenderRealTabPanel()
    return
  }

  if (action === 'atlas') {
    document.querySelector<HTMLButtonElement>('.atlas-tab')?.click()
    return
  }

  if (action === 'open-saved-place' && placeId) {
    openSavedPlace(placeId)
    return
  }

  if (action === 'remove-saved-place' && placeId) {
    event.preventDefault()
    event.stopPropagation()
    removeSavedPlace(placeId)
  }
}

function ensureStyles() {
  if (document.getElementById('city-real-tab-content-styles')) return

  const style = document.createElement('style')
  style.id = 'city-real-tab-content-styles'
  style.textContent = `
    .city-real-tab-panel {
      gap: 16px !important;
      justify-content: flex-start !important;
      padding: 24px !important;
    }
    .city-real-tab-header {
      display: grid;
      gap: 7px;
    }
    .city-real-tab-header > span {
      width: fit-content;
      border-radius: 999px;
      background: rgba(255,253,247,.78);
      color: rgba(42,40,36,.62);
      font-size: 10px;
      font-weight: 950;
      letter-spacing: .08em;
      padding: 8px 12px;
      text-transform: uppercase;
    }
    .city-real-tab-header [role="heading"] {
      color: #2a2824;
      font-size: 27px;
      font-weight: 950;
      letter-spacing: -.055em;
      line-height: 1;
    }
    .city-real-tab-header small {
      color: rgba(42,40,36,.64);
      font-size: 13px;
      font-weight: 750;
      line-height: 1.35;
      max-width: 28rem;
    }
    .city-real-tab-metrics {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .city-real-tab-metric {
      display: grid;
      min-height: 82px;
      align-content: start;
      gap: 3px;
      border: 1px solid rgba(66,47,25,.08);
      border-radius: 18px;
      background: rgba(255,253,247,.62);
      padding: 13px 12px;
    }
    .city-real-tab-metric strong {
      color: #2a2824;
      font-size: 24px;
      font-weight: 950;
      letter-spacing: -.055em;
      line-height: .9;
    }
    .city-real-tab-metric span {
      color: rgba(42,40,36,.76);
      font-size: 11px;
      font-weight: 950;
      line-height: 1.1;
    }
    .city-real-tab-metric small {
      color: rgba(42,40,36,.48);
      font-size: 10px;
      font-weight: 800;
      line-height: 1.15;
    }
    .city-saved-places-list {
      display: grid;
      gap: 10px;
      max-height: min(260px, 31svh);
      overflow-y: auto;
      padding-right: 2px;
      scrollbar-width: thin;
    }
    .city-saved-place-item {
      position: relative;
      border: 1px solid rgba(66,47,25,.08);
      border-radius: 20px;
      background: rgba(255,253,247,.7);
      box-shadow: 0 10px 20px rgba(54,42,28,.05);
      overflow: hidden;
    }
    .city-saved-place-main {
      display: grid;
      width: 100%;
      min-height: 86px;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      align-items: center;
      gap: 11px;
      border: 0;
      background: transparent;
      color: #2a2824;
      font: inherit;
      padding: 14px 44px 14px 14px;
      text-align: left;
    }
    .city-saved-place-pin {
      width: 42px;
      height: 42px;
      border-radius: 15px;
      background: #d9654f;
      box-shadow: inset 0 0 0 8px rgba(255,250,241,.52);
    }
    .city-saved-place-pin.cafe { background: #b66b3e; }
    .city-saved-place-pin.restaurant { background: #c65f46; }
    .city-saved-place-pin.bar { background: #7a5fb2; }
    .city-saved-place-pin.gallery { background: #6f72bd; }
    .city-saved-place-pin.culture { background: #4f7fa5; }
    .city-saved-place-pin.viewpoint { background: #2f8f7f; }
    .city-saved-place-pin.market { background: #c08a2f; }
    .city-saved-place-pin.park { background: #4f8f55; }
    .city-saved-place-pin.shop { background: #7d745d; }
    .city-saved-place-copy {
      display: grid;
      min-width: 0;
      gap: 4px;
    }
    .city-saved-place-copy strong {
      overflow: hidden;
      color: #2a2824;
      font-size: 15px;
      font-weight: 950;
      line-height: 1.08;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .city-saved-place-copy small,
    .city-saved-place-copy em {
      overflow: hidden;
      color: rgba(42,40,36,.58);
      font-size: 11px;
      font-style: normal;
      font-weight: 800;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .city-saved-place-date {
      align-self: start;
      color: rgba(42,40,36,.48);
      font-size: 10px;
      font-weight: 900;
      white-space: nowrap;
    }
    .city-saved-place-remove {
      position: absolute;
      top: 9px;
      right: 9px;
      display: grid;
      width: 27px;
      height: 27px;
      place-items: center;
      border: 0;
      border-radius: 999px;
      background: rgba(42,40,36,.08);
      color: rgba(42,40,36,.62);
      font: inherit;
      font-size: 17px;
      font-weight: 950;
      line-height: 1;
    }
    .city-saved-places-empty {
      display: grid;
      gap: 7px;
      border: 1px dashed #e3d5c0;
      border-radius: 20px;
      background: rgba(255,249,239,.52);
      color: #7e766a;
      padding: 18px;
    }
    .city-saved-places-empty strong {
      color: #2a2824;
      font-size: 15px;
      font-weight: 950;
    }
    .city-saved-places-empty span {
      font-size: 12px;
      font-weight: 760;
      line-height: 1.35;
    }
    .city-real-tab-card-list {
      display: grid;
      gap: 10px;
    }
    .city-real-tab-card {
      display: grid;
      gap: 7px;
      border: 1px solid rgba(66,47,25,.08);
      border-radius: 18px;
      background: rgba(255,253,247,.58);
      padding: 16px;
    }
    .city-real-tab-card.accent-warm { background: rgba(255,247,236,.78); }
    .city-real-tab-card.accent-green { background: rgba(235,246,232,.72); }
    .city-real-tab-card.accent-blue { background: rgba(235,244,248,.74); }
    .city-real-tab-card strong {
      color: #2a2824;
      font-size: 14px;
      font-weight: 950;
      letter-spacing: -.015em;
    }
    .city-real-tab-card span {
      color: rgba(42,40,36,.67);
      font-size: 13px;
      font-weight: 780;
      line-height: 1.35;
    }
    .city-real-tab-actions {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .city-real-tab-action {
      min-height: 42px;
      border: 1px solid rgba(58,38,16,.12);
      border-radius: 15px;
      background: rgba(255,253,247,.78);
      color: #2a2824;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
    }
    .city-real-tab-action.active,
    .city-real-tab-action:first-child {
      border-color: transparent;
      background: #28241f;
      color: #fffaf1;
    }
    @media (max-width: 430px) {
      .city-real-tab-panel { padding: 22px !important; }
      .city-real-tab-metrics { gap: 8px; }
      .city-real-tab-metric { min-height: 76px; padding: 12px 10px; }
      .city-real-tab-metric strong { font-size: 22px; }
      .city-saved-place-main { grid-template-columns: 38px minmax(0, 1fr); }
      .city-saved-place-date { display: none; }
    }
    @media (max-width: 350px) {
      .city-real-tab-metrics,
      .city-real-tab-actions { grid-template-columns: 1fr; }
      .city-real-tab-metric { min-height: 0; }
    }
  `
  document.head.appendChild(style)
}

export function installRealTabContentBridge() {
  if (isInstalled || typeof window === 'undefined') return
  isInstalled = true
  ensureStyles()
  document.addEventListener('click', handleRealTabAction, true)
  observer = new MutationObserver(scheduleRenderRealTabPanel)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] })
  intervalId = window.setInterval(scheduleRenderRealTabPanel, 800)
  scheduleRenderRealTabPanel()
}

export function uninstallRealTabContentBridge() {
  document.removeEventListener('click', handleRealTabAction, true)
  observer?.disconnect()
  observer = null
  if (intervalId !== null) window.clearInterval(intervalId)
  intervalId = null
  isInstalled = false
}
