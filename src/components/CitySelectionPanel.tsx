import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CityHistoryItem } from '../appDomain'

type CitySelectionPanelProps = {
  history: CityHistoryItem[]
  isSearching: boolean
  onSearchSubmit: (query: string) => void
  onSelectCity: (city: CityHistoryItem) => void
  searchMessage: string
}

export function CitySelectionPanel({
  history,
  isSearching,
  onSearchSubmit,
  onSelectCity,
  searchMessage,
}: CitySelectionPanelProps) {
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isSearchActive) {
      searchInputRef.current?.focus()
    }
  }, [isSearchActive])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedQuery = searchQuery.trim()

    if (trimmedQuery) {
      onSearchSubmit(trimmedQuery)
      return
    }

    setIsSearchActive(true)
  }

  return (
    <section className="atlas-city-selection-panel" aria-label="City selection">
      <div className="atlas-city-selection-heading">
        <h2>Choose a city</h2>
        <p>Major cities first. Any place can become a generated atlas later.</p>
      </div>

      <form className="atlas-city-search" role="search" onSubmit={submitSearch} onClick={() => setIsSearchActive(true)}>
        {isSearchActive ? (
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search cities or districts"
            aria-label="Search cities or districts"
            disabled={isSearching}
          />
        ) : (
          <span>Search cities or districts</span>
        )}
        <button type="submit" disabled={isSearching}>
          {isSearching ? 'Searching' : 'Search'}
        </button>
      </form>

      {searchMessage ? <p className="atlas-city-search-message">{searchMessage}</p> : null}

      <div className="atlas-city-list" aria-label="City history">
        {history.length ? (
          history.map((city) => (
            <button key={city.cityId} className="atlas-city-option" type="button" onClick={() => onSelectCity(city)}>
              <span className="atlas-city-dot" aria-hidden="true" />
              <span className="atlas-city-option-copy">
                <strong>{city.name}</strong>
                <small>{city.description}</small>
              </span>
              <em>{city.badge}</em>
            </button>
          ))
        ) : (
          <div className="atlas-city-empty-history">
            <strong>No city history yet</strong>
            <span>Use GPS, Simulated, or Search to add a city here.</span>
          </div>
        )}
      </div>
    </section>
  )
}
