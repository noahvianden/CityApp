import type { MobileGpsDiagnostic } from './mobileDiagnostics'

export type MobileGpsWalkReason =
  | 'simulated'
  | 'gps'
  | 'accuracy-too-low'
  | 'unmapped'
  | 'speed-too-fast'
  | 'stale-sample'
  | null

export type MobileGpsRuntimeDiagnostic = MobileGpsDiagnostic & {
  walkReason: MobileGpsWalkReason
  walkAccepted: boolean
  receivedAt: string
  source: 'walk-controller'
}

type MobileGpsDiagnosticListener = (diagnostic: MobileGpsRuntimeDiagnostic) => void

const listeners = new Set<MobileGpsDiagnosticListener>()
let latestDiagnostic: MobileGpsRuntimeDiagnostic | null = null

export function getLatestMobileGpsDiagnostic() {
  return latestDiagnostic
}

export function subscribeMobileGpsDiagnostics(listener: MobileGpsDiagnosticListener) {
  listeners.add(listener)

  if (latestDiagnostic) {
    listener(latestDiagnostic)
  }

  return () => {
    listeners.delete(listener)
  }
}

export function publishMobileGpsDiagnostic(diagnostic: MobileGpsRuntimeDiagnostic) {
  latestDiagnostic = diagnostic

  listeners.forEach((listener) => listener(diagnostic))

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<MobileGpsRuntimeDiagnostic>('cityprint:mobile-gps-diagnostic', {
        detail: diagnostic,
      }),
    )
  }
}
