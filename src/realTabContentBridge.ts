import { getAtlasFogSnapshot, getAtlasFogVisible, setAtlasFogVisible } from './atlasGeoFogBridge'

type RealTabKey = 'memories' | 'stats' | 'privacy'
type StoredPlaceState = {
  savedIds: string[]
  visitedIds: string[]
  memoryIds: string[]
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

function getPlaceState(): StoredPlaceState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(placeStateStorageKey) ?? '{}')
    return {
      savedIds: readStringArray(parsed.savedIds),
      visitedIds: readStringArray(parsed.visitedIds),
      memoryIds: readStringArray(parsed.memoryIds),
    }
  } catch {
    return { savedIds: [], visitedIds: [], memoryIds: [] }
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

function memoryContent(placeState: StoredPlaceState) {
  const savedCount = placeState.savedIds.length
  const visitedCount = placeState.visitedIds.length
  const memoryCount = placeState.memoryIds.length
  const hasActivity = savedCount > 0 || visitedCount > 0 || memoryCount > 0

  return `
    <div class="city-real-tab-header">
      <span>Memories</span>
      <div role="heading" aria-level="2">Your discovered places</div>
      <small>${escapeHtml(getActiveCityName())} · built from places you save while exploring</small>
    </div>
    <div class="city-real-tab-metrics">
      ${metric('saved places', String(savedCount), 'from place cards')}
      ${metric('visited places', String(visitedCount), 'marked by you')}
      ${metric('memories', String(memoryCount), 'kept for later')}
    </div>
    <div class="city-real-tab-card-list">
      ${card(
        hasActivity ? 'Recent discovery state' : 'No memories yet',
        hasActivity
          ? `${pluralize(savedCount, 'place')} saved, ${pluralize(visitedCount, 'place')} visited, and ${pluralize(memoryCount, 'memory', 'memories')} added.`
          : 'Tap a live place on the Atlas map, then use Save, Visited, or Add memory to start building this page.',
        'warm',
      )}
      ${card(
        'What this page keeps',
        'Only place-level discovery choices are shown here. It does not list your exact GPS trail.',
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

function handleRealTabAction(event: MouseEvent) {
  const actionElement = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-real-tab-action]')
  if (!actionElement) return

  const action = actionElement.dataset.realTabAction
  if (action === 'toggle-fog') {
    setAtlasFogVisible(!getAtlasFogVisible())
    scheduleRenderRealTabPanel()
    return
  }

  if (action === 'atlas') {
    document.querySelector<HTMLButtonElement>('.atlas-tab')?.click()
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
