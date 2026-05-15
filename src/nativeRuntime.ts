import { Browser } from '@capacitor/browser'
import { Clipboard } from '@capacitor/clipboard'
import { Capacitor, type PermissionState } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Geolocation, type Position } from '@capacitor/geolocation'
import { Share } from '@capacitor/share'
import type { GpsLocationSample } from './locationAdapter'

export type AppLocationPermission = 'not-requested' | 'granted' | 'denied'
export type ShareStatus = 'idle' | 'shared' | 'copied'
export type FileSaveStatus = 'idle' | 'saved'

const locationOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
  interval: 2000,
  minimumUpdateInterval: 2000,
}
const nativeWatchSampleMaxAgeMs = 6000
let latestNativeWatchSample: GpsLocationSample | null = null

export function isNativeRuntime() {
  return Capacitor.isNativePlatform()
}

function nativePluginAvailable(pluginName: string) {
  return isNativeRuntime() && Capacitor.isPluginAvailable(pluginName)
}

function mapPermissionState(state: PermissionState): AppLocationPermission {
  if (state === 'granted') {
    return 'granted'
  }

  if (state === 'denied') {
    return 'denied'
  }

  return 'not-requested'
}

function toGpsLocationSample(position: Position): GpsLocationSample {
  return {
    kind: 'gps',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    capturedAt: position.timestamp,
  }
}

function rememberNativeLocationSample(position: Position) {
  const sample = toGpsLocationSample(position)
  latestNativeWatchSample = sample

  return sample
}

export function getLatestNativeWatchSample(maxAgeMs = nativeWatchSampleMaxAgeMs) {
  if (!latestNativeWatchSample) {
    return null
  }

  if (Date.now() - latestNativeWatchSample.capturedAt > maxAgeMs) {
    return null
  }

  return latestNativeWatchSample
}

export function clearLatestNativeWatchSample() {
  latestNativeWatchSample = null
}

export async function checkNativeLocationPermission(): Promise<AppLocationPermission> {
  if (!nativePluginAvailable('Geolocation')) {
    return 'not-requested'
  }

  try {
    const status = await Geolocation.checkPermissions()

    return mapPermissionState(status.location)
  } catch {
    return 'denied'
  }
}

export async function requestNativeLocationPermission(): Promise<AppLocationPermission> {
  if (!nativePluginAvailable('Geolocation')) {
    return 'not-requested'
  }

  try {
    const status = await Geolocation.requestPermissions({ permissions: ['location'] })

    return mapPermissionState(status.location)
  } catch {
    return 'denied'
  }
}

export async function getNativeCurrentLocation(): Promise<GpsLocationSample | null> {
  if (!nativePluginAvailable('Geolocation')) {
    return null
  }

  const cachedWatchSample = getLatestNativeWatchSample()
  if (cachedWatchSample) {
    return cachedWatchSample
  }

  const position = await Geolocation.getCurrentPosition(locationOptions)

  return rememberNativeLocationSample(position)
}

export async function watchNativeLocation(
  onSample: (sample: GpsLocationSample) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  if (!nativePluginAvailable('Geolocation')) {
    return () => undefined
  }

  const watchId = await Geolocation.watchPosition(locationOptions, (position, error) => {
    if (error) {
      onError(error.message ?? 'Device location could not provide a sample.')
      return
    }

    if (position) {
      const sample = rememberNativeLocationSample(position)
      console.info('[atlas-live] native watch sample', {
        accuracyM: sample.accuracyM,
        capturedAt: sample.capturedAt,
      })
      onSample(sample)
    }
  })

  console.info('[atlas-live] native watch started', { watchId })

  return () => {
    console.info('[atlas-live] native watch stopped', { watchId })
    void Geolocation.clearWatch({ id: watchId })
  }
}

export async function copyTextToClipboard(text: string, label = 'Cityprint') {
  try {
    if (nativePluginAvailable('Clipboard')) {
      await Clipboard.write({ string: text, label })
      return true
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return false
  }

  return false
}

export async function shareText(title: string, text: string): Promise<ShareStatus> {
  try {
    if (nativePluginAvailable('Share')) {
      const canShare = await Share.canShare()

      if (canShare.value) {
        await Share.share({
          title,
          text,
          dialogTitle: title,
        })

        return 'shared'
      }
    }

    if (navigator.share) {
      await navigator.share({
        title,
        text,
      })

      return 'shared'
    }
  } catch {
    return 'idle'
  }

  return (await copyTextToClipboard(text, title)) ? 'copied' : 'idle'
}

export async function openExternalUrl(url: string) {
  if (nativePluginAvailable('Browser')) {
    await Browser.open({
      url,
      toolbarColor: '#1d352b',
    })
    return
  }

  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export async function saveTextFile(filename: string, text: string): Promise<FileSaveStatus> {
  if (nativePluginAvailable('Filesystem')) {
    await Filesystem.writeFile({
      path: `Cityprint/${filename}`,
      data: text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    })

    return 'saved'
  }

  if (typeof document === 'undefined') {
    return 'idle'
  }

  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)

  return 'saved'
}
