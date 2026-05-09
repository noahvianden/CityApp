import { useEffect, useState } from 'react'
import './MobileDiagnosticsPanel.css'
import {
  getLatestMobileGpsDiagnostic,
  subscribeMobileGpsDiagnostics,
  type MobileGpsRuntimeDiagnostic,
} from './mobileDiagnosticsEvents'

function formatMetric(value: number | null | undefined, suffix: string) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : 'n/a'
}

function formatTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function MobileDiagnosticsPanel() {
  const [diagnostic, setDiagnostic] = useState<MobileGpsRuntimeDiagnostic | null>(() => getLatestMobileGpsDiagnostic())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => subscribeMobileGpsDiagnostics(setDiagnostic), [])

  if (!diagnostic) {
    return null
  }

  const statusLabel = diagnostic.walkAccepted ? 'Accepted' : 'Rejected'
  const cellLabel = diagnostic.cellId ?? 'No cell'
  const reasonLabel = diagnostic.walkReason ?? diagnostic.reason
  const districtLabel = diagnostic.districtName ?? 'No district'
  const overlapLabel = diagnostic.districtCandidates.length > 1 ? diagnostic.districtCandidates.join(' / ') : districtLabel
  const nearbyPlaceLabel = diagnostic.nearbyPlaceNames.length > 0 ? diagnostic.nearbyPlaceNames.join(', ') : 'none'
  const cityCellSize = diagnostic.cityCellSize
    ? `${diagnostic.cityCellSize.widthMeters.toFixed(0)} x ${diagnostic.cityCellSize.heightMeters.toFixed(0)} m`
    : 'n/a'

  return (
    <section className={`mobile-diagnostics ${diagnostic.walkAccepted ? 'is-accepted' : 'is-rejected'}`} aria-label="Mobile GPS diagnostics">
      <button className="mobile-diagnostics__summary" type="button" onClick={() => setExpanded((current) => !current)}>
        <span>
          <strong>GPS {statusLabel}</strong>
          <small>{cellLabel} · {districtLabel} · {reasonLabel}</small>
        </span>
        <span className="mobile-diagnostics__time">{formatTime(diagnostic.receivedAt)}</span>
      </button>

      {expanded ? (
        <div className="mobile-diagnostics__details">
          <div className="mobile-diagnostics__grid">
            <span>
              <small>District</small>
              <strong>{districtLabel}</strong>
            </span>
            <span>
              <small>District candidates</small>
              <strong>{overlapLabel}</strong>
            </span>
            <span>
              <small>Nearby places</small>
              <strong>{nearbyPlaceLabel}</strong>
            </span>
            <span>
              <small>Accuracy</small>
              <strong>{diagnostic.accuracyLabel}</strong>
            </span>
            <span>
              <small>Reveal radius</small>
              <strong>{diagnostic.revealRadius}</strong>
            </span>
            <span>
              <small>Speed</small>
              <strong>{formatMetric(diagnostic.speedMps, 'm/s')}</strong>
            </span>
            <span>
              <small>Atlas cell size</small>
              <strong>{cityCellSize}</strong>
            </span>
          </div>

          <ul className="mobile-diagnostics__messages">
            {diagnostic.messages.slice(0, 5).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
