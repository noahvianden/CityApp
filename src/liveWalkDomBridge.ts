import {
  clearLatestNativeWatchSample,
  isNativeRuntime,
  requestNativeLocationPermission,
  watchNativeLocation,
} from './nativeRuntime'
import type { GpsLocationSample } from './locationAdapter'

const liveWalkRefreshMinIntervalMs = 4500
const liveWalkRefreshDistanceMeters = 8
const earthRadiusMeters = 6371008.8
let stopNativeWatch: (() => void) | null = null
let lastForwardedSample: GpsLocationSample | null = null
let lastRefreshAt = 0
let pendingRefreshFrame = 0
let isRefreshingFromWatch = false
let isStartingWatch = false
let isInstalled = false

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

function distanceMeters(a: GpsLocationSample, b: GpsLocationSample) {
  const latitudeDelta = degreesToRadians(b.latitude - a.latitude)
  const longitudeDelta = degreesToRadians(b.longitude - a.longitude)
  const startLatitude = degreesToRadians(a.latitude)
  const endLatitude = degreesToRadians(b.latitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function getGpsButton() {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('.atlas-control')).find((button) => {
      const label = button.textContent?.trim().toLowerCase() ?? ''
      return label.includes('gps')
    }) ?? null
  )
}

function getSimulatedButton() {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('.atlas-control')).find((button) => {
      const label = button.textContent?.trim().toLowerCase() ?? ''
      return label.includes('simulated')
    }) ?? null
  )
}

function markLiveWalkActive(active: boolean) {
  document.body.classList.toggle('atlas-live-walk-active', active)
  getGpsButton()?.classList.toggle('live-walk-active', active)
}

function shouldForwardSample(sample: GpsLocationSample) {
  const now = Date.now()
  if (now - lastRefreshAt < liveWalkRefreshMinIntervalMs) {
    return false
  }

  if (!lastForwardedSample) {
    return true
  }

  return distanceMeters(lastForwardedSample, sample) >= liveWalkRefreshDistanceMeters
}

function replayGpsButtonFromWatch(sample: GpsLocationSample) {
  if (!shouldForwardSample(sample)) {
    return
  }

  if (pendingRefreshFrame) {
    return
  }

  pendingRefreshFrame = window.requestAnimationFrame(() => {
    pendingRefreshFrame = 0
    const gpsButton = getGpsButton()

    if (!gpsButton) {
      return
    }

    lastRefreshAt = Date.now()
    lastForwardedSample = sample
    isRefreshingFromWatch = true
    gpsButton.click()
    window.setTimeout(() => {
      isRefreshingFromWatch = false
    }, 0)
  })
}

async function startLiveWalkWatch() {
  if (stopNativeWatch || isStartingWatch || !isNativeRuntime()) {
    return
  }

  isStartingWatch = true
  console.info('[atlas-live] start requested')

  try {
    const permission = await requestNativeLocationPermission()

    if (permission === 'denied') {
      console.warn('[atlas-live] location permission denied')
      return
    }

    stopNativeWatch = await watchNativeLocation(
      (sample) => {
        markLiveWalkActive(true)
        replayGpsButtonFromWatch(sample)
      },
      (message) => {
        console.warn('[atlas-live] native watch error', message)
        stopLiveWalkWatch()
      },
    )
  } finally {
    isStartingWatch = false
  }
}

function stopLiveWalkWatch() {
  stopNativeWatch?.()
  stopNativeWatch = null
  clearLatestNativeWatchSample()
  lastForwardedSample = null
  lastRefreshAt = 0
  markLiveWalkActive(false)
}

function stopOriginalGpsClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  const button = target?.closest<HTMLButtonElement>('button')

  if (!button) {
    return
  }

  if (button === getGpsButton()) {
    if (isRefreshingFromWatch) {
      return
    }

    if (isNativeRuntime()) {
      stopOriginalGpsClick(event)
      void startLiveWalkWatch()
    }
    return
  }

  if (button === getSimulatedButton()) {
    stopLiveWalkWatch()
  }
}

export function installLiveWalkDomBridge() {
  if (isInstalled || typeof document === 'undefined') {
    return
  }

  isInstalled = true
  document.addEventListener('click', handleDocumentClick, true)
  console.info('[atlas-live] DOM bridge installed')
}

installLiveWalkDomBridge()
