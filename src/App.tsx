import { Crosshair, Route } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import { CitySelectionPanel } from './components/CitySelectionPanel'
import { DummyPanel } from './components/DummyPanel'
import { MapLibreCityMap } from './components/MapLibreCityMap'
import { useAtlasController } from './hooks/useAtlasController'

function App() {
  const atlas = useAtlasController()

  return (
    <main className="atlas-core">
      {!atlas.isCitySelectionOpen ? (
        <header className="atlas-header">
          <h1>
            {atlas.activeTab === 'atlas' ? (
              <button
                className="atlas-city-title-button"
                type="button"
                onClick={atlas.openCitySelection}
                aria-label={`Open city selection for ${atlas.displayedTitle}`}
              >
                <span>{atlas.displayedTitle}</span>
              </button>
            ) : (
              atlas.displayedTitle
            )}
          </h1>
        </header>
      ) : null}

      {atlas.activeTab === 'atlas' ? (
        atlas.isCitySelectionOpen ? (
          <CitySelectionPanel
            history={atlas.cityHistory}
            isSearching={atlas.isSearchingCity}
            onSearchSubmit={atlas.searchForCity}
            onSelectCity={atlas.openHistoryCity}
            searchMessage={atlas.citySearchMessage}
          />
        ) : atlas.activeAtlas ? (
          <>
            <div className={atlas.mapFrameClassName} style={atlas.isMapFullscreen ? undefined : atlas.mapFrameStyle}>
              <MapLibreCityMap key={atlas.mapKey} atlas={atlas.activeAtlas} mode={atlas.mode} viewAction={atlas.mapViewAction} />
              <div className="atlas-map-action-top" role="group" aria-label="Map reset and snap controls" style={{ flexDirection: 'column' }}>
                <button className="atlas-map-action-button" type="button" onClick={() => atlas.requestMapViewAction('default')}>
                  Reset
                </button>
                <button className="atlas-map-action-button" type="button" onClick={() => atlas.requestMapViewAction('snap')}>
                  Snap
                </button>
              </div>
              <div className="atlas-map-action-left" role="group" aria-label="Map fullscreen control">
                <button className="atlas-map-action-button" type="button" onClick={() => atlas.setIsMapFullscreen((current) => !current)}>
                  {atlas.isMapFullscreen ? 'Min' : 'Max'}
                </button>
              </div>
            </div>
            <div className="atlas-joycon" role="group" aria-label="Move GPS location">
              <button className="atlas-joycon-button north" type="button" onClick={() => atlas.nudgeGpsLocation('north')} aria-label="Move GPS north">
                ^
              </button>
              <button className="atlas-joycon-button west" type="button" onClick={() => atlas.nudgeGpsLocation('west')} aria-label="Move GPS west">
                &lt;
              </button>
              <span className="atlas-joycon-center" aria-hidden="true" />
              <button className="atlas-joycon-button east" type="button" onClick={() => atlas.nudgeGpsLocation('east')} aria-label="Move GPS east">
                &gt;
              </button>
              <button className="atlas-joycon-button south" type="button" onClick={() => atlas.nudgeGpsLocation('south')} aria-label="Move GPS south">
                v
              </button>
            </div>
          </>
        ) : (
          <div className="atlas-empty-state" style={atlas.mapFrameStyle}>
            <span>{atlas.isLocating ? 'Stadtgrenze wird geladen...' : atlas.locationMessage}</span>
          </div>
        )
      ) : (
        <DummyPanel tab={atlas.activeTabItem} />
      )}

      {atlas.shouldShowAtlasMap ? (
        <div className="atlas-controls" role="group" aria-label="Atlas location controls">
          <button
            className={atlas.mode === 'gps' ? 'atlas-control active' : 'atlas-control'}
            type="button"
            onClick={atlas.useGpsLocation}
            aria-label="GPS"
            aria-busy={atlas.isLocating}
          >
            <Crosshair size={20} aria-hidden="true" />
            <span>GPS</span>
          </button>
          <button
            className={atlas.mode === 'simulated' ? 'atlas-control active' : 'atlas-control'}
            type="button"
            onClick={atlas.activateSimulatedLocation}
            aria-label="Simulated"
            aria-busy={atlas.isLocating && atlas.mode === 'simulated'}
          >
            <Route size={20} aria-hidden="true" />
            <span>Simulated</span>
          </button>
        </div>
      ) : null}

      <nav className="atlas-tabbar" aria-label="App navigation">
        {atlas.appTabs.map((tab) => (
          <button
            key={tab.key}
            className={atlas.activeTab === tab.key ? 'atlas-tab active' : 'atlas-tab'}
            type="button"
            onClick={() => atlas.openTab(tab.key)}
            aria-current={atlas.activeTab === tab.key ? 'page' : undefined}
          >
            <strong>{tab.icon}</strong>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

export default App
