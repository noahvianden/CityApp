import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Coffee,
  Compass,
  Heart,
  Landmark,
  MapPin,
  Navigation,
  Plus,
  Search,
  Sparkles,
  Star,
  Store,
  TreePine,
  Utensils,
  X,
} from 'lucide-react'

type PlaceCategory = 'Cafe' | 'Food' | 'Culture' | 'View' | 'Park' | 'Shop'

type NewPlaceDiscovery = {
  id: string
  name: string
  category: PlaceCategory
  district: string
  distanceLabel: string
  revealReason: string
  description: string
  matchScore: number
  saved?: boolean
  tags: string[]
}

type DiscoveryFilter = {
  id: string
  label: string
  count: number
}

type NewPlaceDiscoveryScreenProps = {
  cityName?: string
  neighborhoodLabel?: string
  revealedMetersLabel?: string
  routeLabel?: string
  discoveryProgressLabel?: string
  places?: NewPlaceDiscovery[]
  activePlaceId?: string
  filters?: DiscoveryFilter[]
  selectedFilterId?: string
  onClose?: () => void
  onContinueWalk?: () => void
  onCreateMemory?: (placeId: string) => void
  onOpenPlace?: (placeId: string) => void
  onSavePlace?: (placeId: string) => void
  onSearch?: () => void
  onSelectFilter?: (filterId: string) => void
}

const categoryIcons: Record<PlaceCategory, LucideIcon> = {
  Cafe: Coffee,
  Food: Utensils,
  Culture: Landmark,
  View: Compass,
  Park: TreePine,
  Shop: Store,
}

const defaultPlaces: NewPlaceDiscovery[] = [
  {
    id: 'canal-roastery',
    name: 'Canal Roastery',
    category: 'Cafe',
    district: 'Old Harbor',
    distanceLabel: '180 m away',
    revealReason: 'Unlocked by the last two revealed cells near the waterline.',
    description: 'A tiny espresso bar with a standing counter, warm window light, and a quiet corner for saving a first city memory.',
    matchScore: 96,
    saved: true,
    tags: ['quiet', 'morning', 'great first stop'],
  },
  {
    id: 'linden-pocket-park',
    name: 'Linden Pocket Park',
    category: 'Park',
    district: 'Linden Quarter',
    distanceLabel: '4 min walk',
    revealReason: 'Appeared after your route crossed the shaded block edge.',
    description: 'Pocket green space with benches, a drinking fountain, and a small public art marker just off the main street.',
    matchScore: 88,
    tags: ['shade', 'short detour', 'rest stop'],
  },
  {
    id: 'marker-hall',
    name: 'Marker Hall',
    category: 'Culture',
    district: 'Station Arcades',
    distanceLabel: '320 m away',
    revealReason: 'Found inside the newest explored district slice.',
    description: 'Independent gallery and event room. Good candidate for a recap-safe highlight because it does not expose an exact route.',
    matchScore: 82,
    tags: ['recap-safe', 'indoors', 'weekend'],
  },
]

const defaultFilters: DiscoveryFilter[] = [
  { id: 'all', label: 'All new', count: 3 },
  { id: 'saved', label: 'Saved', count: 1 },
  { id: 'nearby', label: 'Nearby', count: 2 },
  { id: 'recap-safe', label: 'Recap safe', count: 1 },
]

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function getActivePlace(places: NewPlaceDiscovery[], activePlaceId?: string) {
  return places.find((place) => place.id === activePlaceId) ?? places[0]
}

export function NewPlaceDiscoveryScreen({
  cityName = 'Berlin',
  neighborhoodLabel = 'Mitte edge',
  revealedMetersLabel = '620 m revealed',
  routeLabel = 'Route 3/8',
  discoveryProgressLabel = '3 new places surfaced',
  places = defaultPlaces,
  activePlaceId,
  filters = defaultFilters,
  selectedFilterId = 'all',
  onClose,
  onContinueWalk,
  onCreateMemory,
  onOpenPlace,
  onSavePlace,
  onSearch,
  onSelectFilter,
}: NewPlaceDiscoveryScreenProps) {
  const activePlace = getActivePlace(places, activePlaceId)
  const ActiveIcon = categoryIcons[activePlace.category]

  return (
    <section className="new-place-discovery-screen" aria-label="New place discovery">
      <style>{newPlaceDiscoveryStyles}</style>

      <header className="new-place-discovery-hero">
        <div className="new-place-discovery-topbar">
          <div>
            <p className="new-place-discovery-kicker">New-place discovery</p>
            <h1>Fresh places unlocked in {cityName}</h1>
          </div>
          <div className="new-place-discovery-header-actions">
            <button className="new-place-discovery-icon-button" type="button" onClick={onSearch} aria-label="Search discoveries">
              <Search size={18} />
            </button>
            <button className="new-place-discovery-icon-button dark" type="button" onClick={onClose} aria-label="Close discovery screen">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="new-place-discovery-summary-card">
          <div>
            <span className="new-place-discovery-pill">
              <Sparkles size={15} /> {discoveryProgressLabel}
            </span>
            <p>
              {neighborhoodLabel} · {revealedMetersLabel} · {routeLabel}
            </p>
          </div>
          <button className="new-place-discovery-primary" type="button" onClick={onContinueWalk}>
            Continue walk <ArrowRight size={17} />
          </button>
        </div>
      </header>

      <nav className="new-place-discovery-filters" aria-label="Discovery filters">
        {filters.map((filter) => (
          <button
            key={filter.id}
            className={filter.id === selectedFilterId ? 'new-place-discovery-filter active' : 'new-place-discovery-filter'}
            type="button"
            onClick={() => onSelectFilter?.(filter.id)}
          >
            {filter.label}
            <span>{filter.count}</span>
          </button>
        ))}
      </nav>

      <div className="new-place-discovery-layout">
        <div className="new-place-discovery-list" aria-label="New places">
          {places.map((place) => {
            const Icon = categoryIcons[place.category]
            const isActive = place.id === activePlace.id

            return (
              <button
                key={place.id}
                className={isActive ? 'new-place-discovery-place-card active' : 'new-place-discovery-place-card'}
                type="button"
                onClick={() => onOpenPlace?.(place.id)}
              >
                <span className={`new-place-discovery-place-icon ${slugify(place.category)}`}>
                  <Icon size={20} />
                </span>
                <span className="new-place-discovery-place-copy">
                  <strong>{place.name}</strong>
                  <small>
                    {place.category} · {place.district} · {place.distanceLabel}
                  </small>
                  <em>{place.revealReason}</em>
                </span>
                <span className="new-place-discovery-score" aria-label={`${place.matchScore}% match`}>
                  {place.matchScore}
                </span>
              </button>
            )
          })}
        </div>

        <article className="new-place-discovery-detail" aria-label={`${activePlace.name} details`}>
          <div className="new-place-discovery-detail-map" aria-hidden="true">
            <div className="new-place-discovery-route-line" />
            <span className="new-place-discovery-map-pin user">
              <Navigation size={16} />
            </span>
            <span className={`new-place-discovery-map-pin place ${slugify(activePlace.category)}`}>
              <ActiveIcon size={17} />
            </span>
          </div>

          <div className="new-place-discovery-detail-body">
            <div className="new-place-discovery-detail-title">
              <span className={`new-place-discovery-place-icon ${slugify(activePlace.category)}`}>
                <ActiveIcon size={22} />
              </span>
              <div>
                <p>
                  {activePlace.category} · {activePlace.district}
                </p>
                <h2>{activePlace.name}</h2>
              </div>
            </div>

            <p className="new-place-discovery-description">{activePlace.description}</p>

            <div className="new-place-discovery-insights">
              <div>
                <MapPin size={17} />
                <span>{activePlace.distanceLabel}</span>
              </div>
              <div>
                <Star size={17} />
                <span>{activePlace.matchScore}% route match</span>
              </div>
              <div>
                <Sparkles size={17} />
                <span>{activePlace.revealReason}</span>
              </div>
            </div>

            <div className="new-place-discovery-tags" aria-label="Place tags">
              {activePlace.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>

            <div className="new-place-discovery-actions">
              <button className="new-place-discovery-primary" type="button" onClick={() => onCreateMemory?.(activePlace.id)}>
                <Plus size={17} /> Save memory
              </button>
              <button className="new-place-discovery-secondary" type="button" onClick={() => onSavePlace?.(activePlace.id)}>
                <Heart size={17} /> {activePlace.saved ? 'Saved' : 'Save place'}
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}

export default NewPlaceDiscoveryScreen

const newPlaceDiscoveryStyles = `
.new-place-discovery-screen {
  box-sizing: border-box;
  min-height: 100svh;
  width: 100%;
  overflow-y: auto;
  background:
    radial-gradient(circle at 18% 0%, rgba(255, 255, 255, .82), transparent 34%),
    linear-gradient(180deg, #f8efe0 0%, #eee0ca 100%);
  color: #292620;
  padding: max(28px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom));
}
.new-place-discovery-screen * { box-sizing: border-box; }
.new-place-discovery-hero { display: grid; gap: 18px; margin: 0 auto; max-width: 1060px; }
.new-place-discovery-topbar { align-items: flex-start; display: flex; justify-content: space-between; gap: 16px; }
.new-place-discovery-kicker { color: #b96248; font-size: 11px; font-weight: 900; letter-spacing: .12em; margin: 0 0 8px; text-transform: uppercase; }
.new-place-discovery-topbar h1 { font-size: clamp(32px, 8vw, 68px); letter-spacing: -.07em; line-height: .9; margin: 0; max-width: 780px; }
.new-place-discovery-header-actions { display: flex; gap: 8px; }
.new-place-discovery-icon-button { align-items: center; background: rgba(255, 252, 244, .82); border: 1px solid rgba(80, 52, 20, .1); border-radius: 999px; color: #292620; display: inline-flex; height: 42px; justify-content: center; width: 42px; }
.new-place-discovery-icon-button.dark { background: #292620; color: #fff8ed; }
.new-place-discovery-summary-card { align-items: center; background: rgba(255, 252, 244, .78); border: 1px solid rgba(80, 52, 20, .11); border-radius: 28px; box-shadow: 0 16px 38px rgba(62, 45, 25, .08); display: flex; justify-content: space-between; gap: 18px; padding: 16px; }
.new-place-discovery-summary-card p { color: #766f64; font-size: 14px; font-weight: 700; margin: 9px 0 0; }
.new-place-discovery-pill { align-items: center; background: #292620; border-radius: 999px; color: #fff8ed; display: inline-flex; gap: 7px; font-size: 12px; font-weight: 900; padding: 8px 11px; }
.new-place-discovery-primary, .new-place-discovery-secondary { align-items: center; border: 0; border-radius: 17px; display: inline-flex; font: inherit; font-size: 13px; font-weight: 900; gap: 8px; justify-content: center; min-height: 44px; padding: 0 15px; white-space: nowrap; }
.new-place-discovery-primary { background: #d9654f; color: #fffaf3; box-shadow: 0 12px 22px rgba(217, 101, 79, .22); }
.new-place-discovery-secondary { background: rgba(41, 38, 32, .08); color: #292620; }
.new-place-discovery-filters { display: flex; gap: 9px; margin: 18px auto; max-width: 1060px; overflow-x: auto; padding-bottom: 3px; }
.new-place-discovery-filter { align-items: center; background: rgba(255, 252, 244, .74); border: 1px solid rgba(80, 52, 20, .1); border-radius: 999px; color: #4f493e; display: inline-flex; flex: 0 0 auto; font: inherit; font-size: 13px; font-weight: 900; gap: 9px; height: 38px; padding: 0 12px; }
.new-place-discovery-filter span { background: rgba(41, 38, 32, .09); border-radius: 999px; min-width: 24px; padding: 3px 7px; }
.new-place-discovery-filter.active { background: #292620; color: #fff8ed; }
.new-place-discovery-filter.active span { background: rgba(255, 255, 255, .14); }
.new-place-discovery-layout { display: grid; gap: 16px; grid-template-columns: minmax(0, .92fr) minmax(320px, 1.08fr); margin: 0 auto; max-width: 1060px; }
.new-place-discovery-list { display: grid; gap: 12px; }
.new-place-discovery-place-card { align-items: center; background: rgba(255, 252, 244, .76); border: 1px solid rgba(80, 52, 20, .1); border-radius: 24px; box-shadow: 0 10px 26px rgba(62, 45, 25, .06); color: #292620; display: grid; gap: 12px; grid-template-columns: 48px minmax(0, 1fr) auto; min-height: 106px; padding: 14px; text-align: left; width: 100%; }
.new-place-discovery-place-card.active { background: #fffaf1; border-color: rgba(217, 101, 79, .42); box-shadow: 0 18px 42px rgba(62, 45, 25, .11); }
.new-place-discovery-place-icon { align-items: center; background: #f0d1bb; border-radius: 17px; color: #9d4e32; display: inline-flex; height: 48px; justify-content: center; width: 48px; }
.new-place-discovery-place-icon.park { background: #dce9d0; color: #47724d; }
.new-place-discovery-place-icon.culture { background: #ded9f0; color: #65569b; }
.new-place-discovery-place-icon.view { background: #d6e7ec; color: #3d7280; }
.new-place-discovery-place-icon.food { background: #f2dcc1; color: #9f642e; }
.new-place-discovery-place-icon.shop { background: #ead8e1; color: #904e6f; }
.new-place-discovery-place-copy { display: grid; gap: 5px; min-width: 0; }
.new-place-discovery-place-copy strong { font-size: 17px; font-weight: 950; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new-place-discovery-place-copy small { color: #716b60; font-size: 12px; font-weight: 800; }
.new-place-discovery-place-copy em { color: #8a8175; font-size: 12px; font-style: normal; font-weight: 700; line-height: 1.35; }
.new-place-discovery-score { align-items: center; background: rgba(41, 38, 32, .08); border-radius: 14px; display: flex; font-size: 13px; font-weight: 950; height: 36px; justify-content: center; width: 42px; }
.new-place-discovery-detail { background: rgba(255, 252, 244, .78); border: 1px solid rgba(80, 52, 20, .1); border-radius: 30px; box-shadow: 0 22px 48px rgba(62, 45, 25, .1); overflow: hidden; }
.new-place-discovery-detail-map { background: radial-gradient(circle at 55% 40%, rgba(217, 101, 79, .24), transparent 16%), linear-gradient(135deg, #d9d0bf, #b9c4b3); height: 220px; overflow: hidden; position: relative; }
.new-place-discovery-route-line { background: rgba(255, 250, 243, .74); border-radius: 999px; height: 9px; left: 12%; position: absolute; top: 55%; transform: rotate(-18deg); width: 76%; }
.new-place-discovery-map-pin { align-items: center; border: 3px solid #fffaf3; border-radius: 999px; display: flex; height: 42px; justify-content: center; position: absolute; width: 42px; }
.new-place-discovery-map-pin.user { background: #292620; color: #fffaf3; left: 22%; top: 58%; }
.new-place-discovery-map-pin.place { background: #d9654f; color: #fffaf3; right: 24%; top: 34%; }
.new-place-discovery-map-pin.place.park { background: #47724d; }
.new-place-discovery-map-pin.place.culture { background: #65569b; }
.new-place-discovery-detail-body { display: grid; gap: 16px; padding: 18px; }
.new-place-discovery-detail-title { align-items: center; display: flex; gap: 12px; }
.new-place-discovery-detail-title p { color: #8a8175; font-size: 12px; font-weight: 900; margin: 0 0 4px; }
.new-place-discovery-detail-title h2 { font-size: 26px; letter-spacing: -.045em; line-height: 1; margin: 0; }
.new-place-discovery-description { color: #5f574b; font-size: 14px; font-weight: 700; line-height: 1.5; margin: 0; }
.new-place-discovery-insights { display: grid; gap: 9px; }
.new-place-discovery-insights div { align-items: flex-start; background: rgba(41, 38, 32, .055); border-radius: 16px; color: #514a3f; display: flex; gap: 9px; padding: 11px; }
.new-place-discovery-insights svg { color: #d9654f; flex: 0 0 auto; }
.new-place-discovery-insights span { font-size: 13px; font-weight: 800; line-height: 1.35; }
.new-place-discovery-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.new-place-discovery-tags span { background: rgba(217, 101, 79, .12); border-radius: 999px; color: #954733; font-size: 12px; font-weight: 900; padding: 7px 10px; }
.new-place-discovery-actions { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
button { cursor: pointer; }
button:focus-visible { outline: 3px solid rgba(217, 101, 79, .42); outline-offset: 2px; }
@media (max-width: 780px) {
  .new-place-discovery-screen { padding-inline: 14px; }
  .new-place-discovery-topbar h1 { font-size: 42px; }
  .new-place-discovery-summary-card, .new-place-discovery-layout { grid-template-columns: 1fr; }
  .new-place-discovery-summary-card { align-items: stretch; }
  .new-place-discovery-layout { display: flex; flex-direction: column-reverse; }
  .new-place-discovery-actions { grid-template-columns: 1fr; }
}
`
