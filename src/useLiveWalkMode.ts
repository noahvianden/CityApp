import { useCallback, useEffect, useRef, useState } from 'react'
import { getNativeCurrentLocation, isNativeRuntime, requestNativeLocationPermission, watchNativeLocation } from './nativeRuntime'
import type { GpsLocationSample } from './locationAdapter'
import type { BoundedAtlasPoint } from './nominatimCityBoundaries'
import { applyLiveWalkGpsSample, createLiveWalkDigest, type LiveWalkDigest, type LiveWalkStatus } from './liveWalkMode'

export type LiveWalkModeState = {
  digest: LiveWalkDigest
  isLiveWalking: boolean
  lastSample: GpsLocationSample | null
  sampleCount: number
  status: LiveWalkStatus
}

export type UseLiveWalkModeResult = LiveWalkModeState & {
  startLiveWalk: () => Promise<void>
  stopLiveWalk: () => void
}

type BrowserWatchStop = () => void

type UseLiveWalkModeOptions = {
  activeAtlas: BoundedAtlasPoint | null
  onAtlasChange: (atlas: BoundedAtlasPoint) => void
  onMessage: (message: string) => void
  onModeChange: () => void
  rememberAtlasCity?: (atlas: BoundedAtlasPoint, badge: string) => void
}

const browserLocationOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
}

function toBrowserGpsSample(position: GeolocationPosition): GpsLocationSample {
  return {
    kind: 'gps',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    capturedAt: position.timestamp,
  }
}

function watchBrowserLocation(
  onSample: (sample: GpsLocationSample) => void,
  onError: (message: string) => void,
): BrowserWatchStop {
  if (!navigator.geolocation) {
    onError('Browser geolocation is not available.')
    return () => undefined
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => onSample(toBrowserGpsSample(position)),
    (error) => onError(error.message || 'Browser GPS could not provide a sample.'),
    browserLocationOptions,
  )

  return () => navigator.geolocation.clearWatch(watchId)
}

export function useLiveWalkMode({
  activeAtlas,
  onAtlasChange,
  onMessage,
  onModeChange,
  rememberAtlasCity,
}: UseLiveWalkModeOptions): UseLiveWalkModeResult {
  const [lastSample, setLastSample] = useState<GpsLocationSample | null>(null)
  const [sampleCount, setSampleCount] = useState(0)
  const [status, setStatus] = useState<LiveWalkStatus>('idle')
  const activeAtlasRef = useRef(activeAtlas)
  const stopWatchingRef = useRef<BrowserWatchStop | null>(null)
  const sampleQueueRef = useRef(Promise.resolve())

  useEffect(() => {
    activeAtlasRef.current = activeAtlas
  }, [activeAtlas])

  const stopLiveWalk = useCallback(() => {
    stopWatchingRef.current?.()
    stopWatchingRef.current = null
    setStatus((current) => (current === 'idle' ? current : 'paused'))
  }, [])

  const handleSample = useCallback((sample: GpsLocationSample) => {
    setLastSample(sample)
    setSampleCount((current) => current + 1)
    setStatus('walking')
    onModeChange()

    sampleQueueRef.current = sampleQueueRef.current
      .then(async () => {
        const update = await applyLiveWalkGpsSample(activeAtlasRef.current, sample)

        if (update.atlas) {
          activeAtlasRef.current = update.atlas
          onAtlasChange(update.atlas)

          if (!update.matchedExistingBoundary) {
            rememberAtlasCity?.(update.atlas, 'live')
          }
        }

        onMessage(update.message)
      })
      .catch(() => {
        setStatus('error')
        onMessage('Live GPS update failed. Please try restarting Live walk.')
      })
  }, [onAtlasChange, onMessage, onModeChange, rememberAtlasCity])

  const startLiveWalk = useCallback(async () => {
    if (stopWatchingRef.current) {
      return
    }

    setStatus('starting')
    onModeChange()
    onMessage('Starting continuous GPS...')

    if (isNativeRuntime()) {
      const permission = await requestNativeLocationPermission()

      if (permission === 'denied') {
        setStatus('error')
        onMessage('GPS permission was denied.')
        return
      }

      const firstSample = await getNativeCurrentLocation()
      if (firstSample) {
        handleSample(firstSample)
      }

      stopWatchingRef.current = await watchNativeLocation(handleSample, (message) => {
        setStatus('error')
        onMessage(message)
      })
      return
    }

    stopWatchingRef.current = watchBrowserLocation(handleSample, (message) => {
      setStatus('error')
      onMessage(message)
    })
  }, [handleSample, onMessage, onModeChange])

  useEffect(() => stopLiveWalk, [stopLiveWalk])

  const isLiveWalking = status === 'starting' || status === 'walking'
  const digest = createLiveWalkDigest(status, sampleCount, lastSample, activeAtlas)

  return {
    digest,
    isLiveWalking,
    lastSample,
    sampleCount,
    startLiveWalk,
    status,
    stopLiveWalk,
  }
}
