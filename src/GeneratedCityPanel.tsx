import { useMemo, useState } from 'react'
import { MapPin, Navigation, Plus, RefreshCcw } from 'lucide-react'
import { registerDynamicCityGeoBounds } from './cityGeoBounds'
import { cities } from './cityprintData'
import { createGeneratedCityProfile, createGeneratedCityRecord, readGeneratedCityRecords, upsertGeneratedCityRecord } from './generatedCityModel'
import { getNativeCurrentLocation, requestNativeLocationPermission } from './nativeRuntime'
import { cityprintStorageKey, readCityprintSnapshot, writeCityprintSnapshot } from './persistence'
import './GeneratedCityPanel.css'

function parseCoordinate(value: string) {
  const parsed = Number(value.trim().replace(',', '.'))

  return Number.isFinite(parsed) ? parsed : null
}

function addGeneratedCityToRuntime(record: ReturnType<typeof createGeneratedCityRecord>) {
  registerDynamicCityGeoBounds(record.id, record.bounds)

  if (!cities.some((city) => city.id === record.id)) {
    cities.splice(1, 0, createGeneratedCityProfile(record))
  }
}

function selectCity(cityId: string) {
  const snapshot = readCityprintSnapshot()

  writeCityprintSnapshot({
    ...snapshot,
    selectedCityId: cityId,
    location: {
      ...snapshot.location,
      mode: 'gps',
    },
  })

  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}

export default function GeneratedCityPanel() {
  const [expanded, setExpanded] = useState(false)
  const [cityName, setCityName] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [records, setRecords] = useState(() => readGeneratedCityRecords())

  const selectedCityId = useMemo(() => readCityprintSnapshot().selectedCityId, [])

  async function useCurrentLocation() {
    setIsLocating(true)
    setStatus('Requesting current location…')

    try {
      await requestNativeLocationPermission()
      const sample = await getNativeCurrentLocation()

      if (!sample) {
        setStatus('Current GPS is not available here. Enter latitude and longitude manually for now.')
        return
      }

      setLatitude(sample.latitude.toFixed(6))
      setLongitude(sample.longitude.toFixed(6))
      setStatus('Current location added. Name the city and save it.')
    } catch {
      setStatus('Could not read current location. Enter coordinates manually for now.')
    } finally {
      setIsLocating(false)
    }
  }

  function createCity() {
    const lat = parseCoordinate(latitude)
    const lon = parseCoordinate(longitude)

    if (!cityName.trim()) {
      setStatus('Add a city name first.')
      return
    }

    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setStatus('Enter valid latitude and longitude.')
      return
    }

    const record = createGeneratedCityRecord({
      name: cityName,
      country: 'Custom',
      point: {
        latitude: lat,
        longitude: lon,
      },
    })

    upsertGeneratedCityRecord(record)
    addGeneratedCityToRuntime(record)
    setRecords(readGeneratedCityRecords())
    setStatus(`${record.name} was created and selected.`)
    selectCity(record.id)
  }

  return (
    <section className={`generated-city-panel ${expanded ? 'is-expanded' : ''}`} aria-label="Custom city creator">
      <button className="generated-city-panel__toggle" type="button" onClick={() => setExpanded((current) => !current)}>
        <span>
          <strong>Any city</strong>
          <small>Create or select a local atlas</small>
        </span>
        <MapPin aria-hidden="true" />
      </button>

      {expanded ? (
        <div className="generated-city-panel__body">
          <div className="generated-city-panel__field">
            <label htmlFor="generated-city-name">City name</label>
            <input
              id="generated-city-name"
              value={cityName}
              placeholder="Munich, Lisbon, Tokyo…"
              onChange={(event) => setCityName(event.target.value)}
            />
          </div>

          <div className="generated-city-panel__coords">
            <div className="generated-city-panel__field">
              <label htmlFor="generated-city-latitude">Latitude</label>
              <input
                id="generated-city-latitude"
                inputMode="decimal"
                value={latitude}
                placeholder="48.1372"
                onChange={(event) => setLatitude(event.target.value)}
              />
            </div>
            <div className="generated-city-panel__field">
              <label htmlFor="generated-city-longitude">Longitude</label>
              <input
                id="generated-city-longitude"
                inputMode="decimal"
                value={longitude}
                placeholder="11.5756"
                onChange={(event) => setLongitude(event.target.value)}
              />
            </div>
          </div>

          <div className="generated-city-panel__actions">
            <button type="button" onClick={useCurrentLocation} disabled={isLocating}>
              <Navigation aria-hidden="true" />
              {isLocating ? 'Locating…' : 'Use GPS'}
            </button>
            <button type="button" onClick={createCity}>
              <Plus aria-hidden="true" />
              Create city
            </button>
          </div>

          {records.length > 0 ? (
            <div className="generated-city-panel__saved">
              <div className="generated-city-panel__saved-title">
                <span>Saved custom cities</span>
                <button type="button" onClick={() => setRecords(readGeneratedCityRecords())} aria-label="Refresh saved custom cities">
                  <RefreshCcw aria-hidden="true" />
                </button>
              </div>
              {records.slice(0, 6).map((record) => (
                <button
                  key={record.id}
                  type="button"
                  className={record.id === selectedCityId ? 'is-selected' : ''}
                  onClick={() => selectCity(record.id)}
                >
                  <span>{record.name}</span>
                  <small>{record.country}</small>
                </button>
              ))}
            </div>
          ) : null}

          {status ? <p className="generated-city-panel__status">{status}</p> : null}
          <p className="generated-city-panel__note">
            Custom cities store only an approximate generated area, not your precise GPS trace. App progress reloads into the selected city after creation.
          </p>
        </div>
      ) : null}
    </section>
  )
}
