import { describe, expect, it } from 'vitest'
import { cities } from './cityprintData'
import { createIdleWalkSession, pauseWalkSession, resumeWalkSession, startWalkSession, stepWalk } from './walkController'

describe('walk controller', () => {
  it('starts, pauses, and resumes sessions', () => {
    const idle = createIdleWalkSession()
    const running = startWalkSession(idle, 100)
    const paused = pauseWalkSession(running, 'background', 200)
    const resumed = resumeWalkSession(paused, 300)

    expect(running.status).toBe('running')
    expect(paused.status).toBe('background')
    expect(resumed.status).toBe('running')
  })

  it('advances while running and reports simulated samples', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'running',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: null,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe', 'canal-bench']),
      now: 1000,
    })

    expect(step.session.routeIndex).toBe(1)
    expect(step.session.routeTrace).toEqual(['3-6', '3-5'])
    expect(step.session.acceptedSampleCount).toBe(1)
    expect(step.discoveryPlaceIds).toEqual(['arcade-house', 'station-hall'])
    expect(step.session.status).toBe('paused')
    expect(step.sampleReason).toBe('simulated')
  })

  it('does not advance when not running', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'background',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: 2,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
    })

    expect(step.session.routeIndex).toBe(0)
    expect(step.sampleCellId).toBeNull()
  })

  it('accepts an injected gps sample while running', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'running',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: null,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      sample: {
        kind: 'gps',
        latitude: 12,
        longitude: 12,
        accuracyM: 12,
        capturedAt: 1000,
      },
      now: 1000,
    })

    expect(step.session.routeIndex).toBe(1)
    expect(step.sampleCellId).not.toBeNull()
    expect(step.sampleReason).toBe('gps')
    expect(step.session.acceptedSampleCount).toBe(1)
    expect(step.session.routeTrace.at(-1)).toBe(step.sampleCellId)
    expect(step.session.status).toMatch(/running|paused|idle/)
  })

  it('reports rejected gps samples without advancing the session', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'running',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: null,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      sample: {
        kind: 'gps',
        latitude: 12,
        longitude: 12,
        accuracyM: 100,
        capturedAt: 1000,
      },
      now: 1000,
    })

    expect(step.session.routeIndex).toBe(0)
    expect(step.sampleCellId).toBeNull()
    expect(step.sampleReason).toBe('accuracy-too-low')
    expect(step.session.acceptedSampleCount ?? 0).toBe(0)
    expect(step.session.status).toBe('running')
  })

  it('keeps background sessions background when a gps sample is rejected', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'background',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: 2,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      sample: {
        kind: 'gps',
        latitude: 12,
        longitude: 12,
        accuracyM: 100,
        capturedAt: 1000,
      },
      now: 1000,
    })

    expect(step.session.status).toBe('background')
    expect(step.session.routeIndex).toBe(0)
    expect(step.sampleReason).toBe('accuracy-too-low')
  })

  it('rejects stale gps samples without advancing the session', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'running',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: null,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      sample: {
        kind: 'gps',
        latitude: 12,
        longitude: 12,
        accuracyM: 12,
        capturedAt: 1000,
      },
      now: 40000,
    })

    expect(step.session.routeIndex).toBe(0)
    expect(step.sampleCellId).not.toBeNull()
    expect(step.sampleReason).toBe('stale-sample')
    expect(step.session.lastSampleAt).toBeNull()
    expect(step.session.status).toBe('running')
  })

  it('accepts gps samples while backgrounded without switching the session out of background', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'background',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: 2,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      sample: {
        kind: 'gps',
        latitude: 12,
        longitude: 12,
        accuracyM: 12,
        capturedAt: 1000,
      },
      now: 1000,
    })

    expect(step.session.routeIndex).toBe(1)
    expect(step.sampleReason).toBe('gps')
    expect(step.session.status).toBe('background')
  })

  it('keeps background sessions background when no gps sample is injected', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'background',
        routeIndex: 0,
        routeTrace: ['3-6'],
        startedAt: 1,
        pausedAt: 2,
        lastSampleAt: null,
        lastSampleCellId: null,
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      now: 1000,
    })

    expect(step.session.routeIndex).toBe(0)
    expect(step.session.status).toBe('background')
    expect(step.sampleCellId).toBeNull()
  })

  it('keeps repeated gps samples on the same cell from advancing the route', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'running',
        routeIndex: 2,
        routeTrace: ['3-6', '3-5', '3-4'],
        startedAt: 1,
        pausedAt: null,
        lastSampleAt: 500,
        lastSampleCellId: '3-4',
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      sample: {
        kind: 'gps',
        latitude: 56,
        longitude: 50,
        accuracyM: 12,
        capturedAt: 1000,
      },
      now: 1000,
    })

    expect(step.session.routeIndex).toBe(2)
    expect(step.advancedRoute).toBe(false)
    expect(step.session.lastSampleCellId).toBe('3-4')
    expect(step.session.status).toBe('running')
  })

  it('rejects gps samples that move too far too quickly for walking', () => {
    const city = cities[0]
    const step = stepWalk({
      city,
      session: {
        status: 'running',
        routeIndex: 2,
        routeTrace: ['3-6', '3-5', '3-4'],
        startedAt: 1,
        pausedAt: null,
        lastSampleAt: 1000,
        lastSampleCellId: '3-5',
      },
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe']),
      sample: {
        kind: 'gps',
        latitude: 43,
        longitude: 78,
        accuracyM: 12,
        capturedAt: 1100,
      },
      now: 1100,
    })

    expect(step.session.routeIndex).toBe(2)
    expect(step.sampleReason).toBe('speed-too-fast')
    expect(step.sampleCellId).toBe('5-3')
    expect(step.session.lastSampleAt).toBe(1000)
    expect(step.session.lastSampleCellId).toBe('3-5')
    expect(step.session.status).toBe('running')
  })
})
