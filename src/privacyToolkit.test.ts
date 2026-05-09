import { describe, expect, it } from 'vitest'
import { defaultLocationSettings, defaultPrivacy } from './appState'
import {
  buildExportFilename,
  buildExportPreview,
  buildPrivacyRules,
  buildRouteTracePath,
  createResetSnapshot,
  describeExactRouteVisibility,
  describeRouteTraceVisibility,
  hasLocalProgress,
  snapshotToPrettyJson,
  summarizeRouteTrace,
} from './privacyToolkit'
import { cities } from './cityprintData'

describe('privacy toolkit', () => {
  it('builds readable privacy rules from the current settings', () => {
    const rules = buildPrivacyRules({ ...defaultPrivacy, preciseLocation: true, backupEnabled: true })

    expect(rules.find((rule) => rule.id === 'private-by-default')?.enabled).toBe(true)
    expect(rules.find((rule) => rule.id === 'exact-route')?.enabled).toBe(true)
    expect(rules.find((rule) => rule.id === 'precise-location')?.enabled).toBe(true)
    expect(rules.find((rule) => rule.id === 'backup-control')?.enabled).toBe(false)
  })

  it('describes exact route visibility from privacy settings', () => {
    expect(describeExactRouteVisibility(defaultPrivacy)).toEqual({
      visible: false,
      label: 'District fragments',
      detail: 'The atlas keeps the walked path generalized to district-level fragments.',
    })

    expect(describeExactRouteVisibility({ ...defaultPrivacy, recapExactRoutes: true })).toEqual({
      visible: true,
      label: 'Exact route visible',
      detail: 'The atlas and recap can show the walked path.',
    })
  })

  it('generalizes route paths and summaries when exact routes are hidden', () => {
    const city = cities[0]
    const routeTrace = ['3-6', '3-5', '3-4', '4-4', '4-3', '5-3']

    expect(describeRouteTraceVisibility(defaultPrivacy)).toEqual({
      visible: false,
      label: 'District fragments',
      detail: 'The atlas keeps the walked path generalized to district-level fragments.',
    })
    expect(buildRouteTracePath(city, routeTrace, defaultPrivacy)).toBe('472,680 334,370 608,362')
    expect(summarizeRouteTrace(city, routeTrace)).toEqual(['Station South', 'Old Center', 'Garden East'])
  })

  it('creates a stable export preview and reset snapshot', () => {
    const preview = buildExportPreview({
      selectedCityId: 'berlin',
      privacy: defaultPrivacy,
      location: {
        ...defaultLocationSettings,
        mode: 'gps',
        permission: 'granted',
        gpsLatitude: '12.3',
        gpsLongitude: '45.6',
        gpsAccuracy: '9',
      },
      cityProgress: {
        berlin: {
          revealedCells: ['1-1'],
          seenPlaceIds: ['place-1'],
          savedPlaceIds: ['place-1'],
          routeIndex: 2,
          routeTrace: ['3-6', '3-5', '3-4'],
          acceptedSampleCount: 0,
          latestRevealDigest: null,
          discoveryIds: [],
          reviewedDiscoveryIds: [],
          memories: [],
        },
      },
    })

    expect(preview.app).toBe('Cityprint')
    expect(preview.cityProgress).toHaveLength(1)
    expect(preview.location).toEqual({
      mode: 'gps',
      permission: 'granted',
    })
    expect(snapshotToPrettyJson(createResetSnapshot())).toContain('"cityProgress": []')
    expect(snapshotToPrettyJson(createResetSnapshot())).toContain('"location": {')
  })

  it('builds a safe export filename from the selected city and timestamp', () => {
    expect(buildExportFilename(createResetSnapshot(), '2026-05-09T06:17:22.123Z')).toBe(
      'cityprint-export-2026-05-09_06-17-22-123Z.json',
    )

    expect(
      buildExportFilename(
        {
          ...createResetSnapshot(),
          selectedCityId: 'berlin',
        },
        '2026-05-09T06:17:22.123Z',
      ),
    ).toBe('cityprint-berlin-export-2026-05-09_06-17-22-123Z.json')
  })

  it('treats privacy changes as local progress', () => {
    expect(hasLocalProgress(createResetSnapshot())).toBe(false)
    expect(
      hasLocalProgress({
        ...createResetSnapshot(),
        privacy: { ...defaultPrivacy, preciseLocation: true },
      }),
    ).toBe(true)
  })
})
