import { describe, expect, it } from 'vitest'
import { defaultPrivacy } from './appState'
import { cities } from './cityprintData'
import { buildCityRecap, buildRecapExportFilename, recapExportToPrettyJson } from './recapModel'

describe('recap model', () => {
  it('builds a privacy-aware recap from visible places and memories', () => {
    const city = cities[0]
    const recap = buildCityRecap({
      city,
      progress: 36,
      distanceWalkedKm: '1.8',
      revealedCells: new Set(['2-5', '3-5', '3-6', '4-4', '4-6']),
      routeTrace: ['3-6', '3-5', '3-4', '4-4', '4-3', '5-3'],
      visiblePlaces: city.places.filter((place) => ['linden-cafe', 'canal-bench', 'arcade-house', 'station-hall'].includes(place.id)),
      savedPlaceIds: new Set(['linden-cafe']),
      memories: [
        {
          id: 'memory-1',
          title: 'Window seat',
          text: 'Quiet coffee and notes.',
          tag: 'quiet',
          visibility: 'Recap allowed',
          placeId: 'linden-cafe',
          hasPhoto: false,
          createdAt: 'Today',
        },
        {
          id: 'memory-2',
          title: 'Private thought',
          text: 'Keep this hidden.',
          tag: 'walk',
          visibility: 'Private',
          hasPhoto: false,
          createdAt: 'Today',
        },
      ],
      privacy: defaultPrivacy,
      latestReveal: {
        routeLabel: 'Route 4/10',
        revealedCellCount: 3,
        placeCount: 2,
        reviewedCount: 1,
        pendingCount: 1,
        featuredPlaceName: 'Arcade House',
      },
    })

    expect(recap.title).toBe('Berlin private recap')
    expect(recap.shareablePlaces.map((place) => place.id)).toContain('linden-cafe')
    expect(recap.shareableMemories.map((memory) => memory.title)).toEqual(['Window seat'])
    expect(recap.routeFragments).toEqual(['Station South', 'Old Center', 'Garden East'])
    expect(recap.summary).toContain('36% revealed in Berlin')
    expect(recap.summary).toContain('Session review digest: 2 places around Route 4/10.')
    expect(recap.shareText).toContain('Route fragments: Station South -> Old Center -> Garden East')
    expect(recap.shareText).toContain('Session review digest: 2 places around Route 4/10. 1 reviewed, 1 open.')
    expect(recap.shareText).toContain('Route detail: exact route hidden.')
    expect(recap.latestReveal).toMatchObject({
      routeLabel: 'Route 4/10',
      placeCount: 2,
      reviewedCount: 1,
      pendingCount: 1,
    })
  })

  it('filters sensitive places only when the privacy rule is enabled', () => {
    const city = cities[0]
    const visiblePlaces = [
      {
        ...city.places[0],
        id: 'night-bar',
        name: 'Night Bar',
        category: 'bar' as const,
      },
      city.places[1],
    ]

    const hiddenRecap = buildCityRecap({
      city,
      progress: 20,
      distanceWalkedKm: '0.9',
      revealedCells: new Set(['2-5', '3-5']),
      routeTrace: ['3-6', '3-5'],
      visiblePlaces,
      savedPlaceIds: new Set(),
      memories: [],
      privacy: defaultPrivacy,
    })

    const openRecap = buildCityRecap({
      city,
      progress: 20,
      distanceWalkedKm: '0.9',
      revealedCells: new Set(['2-5', '3-5']),
      routeTrace: ['3-6', '3-5'],
      visiblePlaces,
      savedPlaceIds: new Set(),
      memories: [],
      privacy: { ...defaultPrivacy, hideSensitivePlaces: false },
    })

    expect(hiddenRecap.shareablePlaces.map((place) => place.id)).not.toContain('night-bar')
    expect(openRecap.shareablePlaces.map((place) => place.id)).toContain('night-bar')
  })

  it('builds a structured recap export with a safe filename', () => {
    const city = cities[0]
    const recap = buildCityRecap({
      city,
      progress: 22,
      distanceWalkedKm: '1.1',
      revealedCells: new Set(['2-5', '3-5']),
      routeTrace: ['3-6', '3-5'],
      visiblePlaces: city.places.slice(0, 2),
      savedPlaceIds: new Set(['linden-cafe']),
      memories: [],
      privacy: defaultPrivacy,
    })

    const exported = JSON.parse(recapExportToPrettyJson(city, recap, '2026-05-09T09:30:00.000Z'))

    expect(buildRecapExportFilename(city.name, '2026-05-09T09:30:00.000Z')).toBe('cityprint-berlin-recap-2026-05-09T09-30-00-000Z.json')
    expect(exported).toMatchObject({
      app: 'Cityprint',
      cityName: city.name,
      exportedAt: '2026-05-09T09:30:00.000Z',
      latestReveal: null,
      recap: {
        title: recap.title,
        privacyNotes: recap.privacyNotes,
      },
    })
  })
})
