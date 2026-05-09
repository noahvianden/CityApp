import { describe, expect, it } from 'vitest'
import { defaultLocationSettings } from './appState'
import { cities } from './cityprintData'
import { createLocationFeedProvider, describeLocationPipeline, describeLocationSampleOutcome } from './locationFeed'
import { createIdleWalkSession, startWalkSession } from './walkController'

describe('location feed', () => {
  it('describes simulated and gps provider state', () => {
    const running = startWalkSession(createIdleWalkSession(), 100)
    const background = {
      ...running,
      status: 'background' as const,
    }
    const simulated = createLocationFeedProvider(defaultLocationSettings)
    const pendingGps = createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps' })
    const blocked = createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'denied' })
    const privacyBlocked = createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'granted' })
    const backgroundGps = createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'granted' })

    expect(simulated.describe(running)).toEqual({
      mode: 'simulated',
      permission: 'not-requested',
      status: 'running',
      lastReason: 'simulated',
    })

    expect(simulated.describe(background)).toEqual({
      mode: 'simulated',
      permission: 'not-requested',
      status: 'background',
      lastReason: 'background',
    })

    expect(backgroundGps.describe(background)).toEqual({
      mode: 'gps',
      permission: 'granted',
      status: 'background',
      lastReason: 'background',
    })

    expect(pendingGps.describe(running)).toEqual({
      mode: 'gps',
      permission: 'not-requested',
      status: 'blocked',
      lastReason: 'permission-pending',
    })

    expect(privacyBlocked.describe(running, false)).toEqual({
      mode: 'gps',
      permission: 'granted',
      status: 'blocked',
      lastReason: 'privacy-blocked',
    })

    expect(blocked.describe(running)).toEqual({
      mode: 'gps',
      permission: 'denied',
      status: 'blocked',
      lastReason: 'permission-denied',
    })
  })

  it('creates simulated and gps samples from the provider', () => {
    const city = cities[0]
    const running = startWalkSession(createIdleWalkSession(), 100)
    const background = {
      ...running,
      status: 'background' as const,
    }
    const simulated = createLocationFeedProvider(defaultLocationSettings)
    const gps = createLocationFeedProvider({
      ...defaultLocationSettings,
      mode: 'gps',
      permission: 'granted',
      gpsLatitude: '12.5',
      gpsLongitude: '45.1',
      gpsAccuracy: '11',
    })

    expect(simulated.createSample(city, running, 300)).toMatchObject({
      kind: 'simulated',
      capturedAt: 300,
    })

    expect(gps.createSample(city, running, 400)).toMatchObject({
      kind: 'gps',
      latitude: 12.5,
      longitude: 45.1,
      accuracyM: 11,
      capturedAt: 400,
    })

    expect(gps.createSample(city, background, 500)).toMatchObject({
      kind: 'gps',
      capturedAt: 500,
    })
    expect(gps.createSample(city, running, 600, false)).toBeNull()
  })

  it('exposes a stable interval and active gate', () => {
    const running = startWalkSession(createIdleWalkSession(), 100)
    const background = {
      ...running,
      status: 'background' as const,
    }

    expect(createLocationFeedProvider(defaultLocationSettings).intervalMs).toBe(2000)
    expect(createLocationFeedProvider(defaultLocationSettings).isActive(running)).toBe(true)
    expect(createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'granted' }).isActive(background)).toBe(true)
    expect(createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'denied' }).isActive(running)).toBe(false)
    expect(createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'granted' }).isActive(running, false)).toBe(false)
  })

  it('describes the pipeline copy for simulated and gps modes', () => {
    const running = startWalkSession(createIdleWalkSession(), 100)
    const background = {
      ...running,
      status: 'background' as const,
    }
    const simulatedFeed = createLocationFeedProvider(defaultLocationSettings).describe(running)
    const simulatedPipeline = describeLocationPipeline(defaultLocationSettings, simulatedFeed, running)
    const pendingPipeline = describeLocationPipeline(
      { ...defaultLocationSettings, mode: 'gps' },
      createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps' }).describe(running),
      running,
    )
    const gpsPipeline = describeLocationPipeline(
      { ...defaultLocationSettings, mode: 'gps', permission: 'denied' },
      createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'denied' }).describe(running),
      running,
    )

    expect(simulatedPipeline.title).toBe('Simulated feed active')
    expect(simulatedPipeline.nextAction).toContain('Pause or background the walk')
    expect(simulatedPipeline.modeLabel).toBe('Simulated')
    expect(simulatedPipeline.sampleLabel).toBe('Simulated route sample')

    const simulatedBackgroundPipeline = describeLocationPipeline(
      defaultLocationSettings,
      createLocationFeedProvider(defaultLocationSettings).describe(background),
      background,
    )

    expect(simulatedBackgroundPipeline.title).toBe('Simulated feed backgrounded')
    expect(simulatedBackgroundPipeline.statusLabel).toBe('Background')
    expect(simulatedBackgroundPipeline.nextAction).toContain('resume the walk')

    expect(pendingPipeline.title).toBe('GPS feed waiting for permission')
    expect(pendingPipeline.permissionLabel).toBe('Permission pending')
    expect(pendingPipeline.statusLabel).toBe('Blocked')
    expect(pendingPipeline.nextAction).toContain('Request device location')

    expect(gpsPipeline.title).toBe('GPS feed blocked')
    expect(gpsPipeline.permissionLabel).toBe('Permission denied')
    expect(gpsPipeline.statusLabel).toBe('Blocked')
    expect(gpsPipeline.sampleLabel).toBe('Permission blocked')
    expect(gpsPipeline.nextAction).toContain('device location access')

    const activeGpsFeed = createLocationFeedProvider({
      ...defaultLocationSettings,
      mode: 'gps',
      permission: 'granted',
    }).describe(running, true)
    const activeGpsPipeline = describeLocationPipeline(
      { ...defaultLocationSettings, mode: 'gps', permission: 'granted' },
      activeGpsFeed,
      running,
    )

    expect(activeGpsPipeline.title).toBe('GPS feed active')
    expect(activeGpsPipeline.detail).toContain('Stale samples are ignored')

    const privacyBlockedPipeline = describeLocationPipeline(
      { ...defaultLocationSettings, mode: 'gps', permission: 'granted' },
      createLocationFeedProvider({ ...defaultLocationSettings, mode: 'gps', permission: 'granted' }).describe(running, false),
      running,
    )

    expect(privacyBlockedPipeline.title).toBe('Precise location disabled')
    expect(privacyBlockedPipeline.sampleLabel).toBe('Precise location off')
    expect(privacyBlockedPipeline.nextAction).toContain('precise location')
  })

  it('describes accepted and rejected sample outcomes clearly', () => {
    expect(
      describeLocationSampleOutcome({
        sampleKind: 'gps',
        acceptedSampleCount: 3,
        sampleReason: 'gps',
        discoveryPlaceCount: 2,
        sampleCellId: '3-5',
        advancedRoute: true,
      }),
    ).toEqual({
      title: 'GPS sample accepted',
      detail: 'Accepted sample #3 revealed 2 new places and paused the walk.',
      tone: 'live',
    })

    expect(
      describeLocationSampleOutcome({
        sampleKind: 'gps',
        acceptedSampleCount: 0,
        sampleReason: 'accuracy-too-low',
        discoveryPlaceCount: 0,
        sampleCellId: '3-5',
        advancedRoute: false,
      }),
    ).toEqual({
      title: 'GPS sample ignored',
      detail: 'Accuracy is above 50 m. The walk stayed on 3-5.',
      tone: 'warning',
    })
  })
})
