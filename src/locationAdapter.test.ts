import { describe, expect, it } from 'vitest'
import { createSimulatedWalkSamples, nextSampleFromRoute, sampleNeighborhood, sampleToCellId } from './locationAdapter'

describe('location adapter', () => {
  it('passes through simulated samples as cells', () => {
    const sample = nextSampleFromRoute(['3-6'], 0, 1000)

    expect(sampleToCellId(sample!)).toEqual({
      cellId: '3-6',
      accepted: true,
      reason: 'simulated',
    })
  })

  it('rejects low-accuracy gps samples and maps better ones to a grid cell', () => {
    expect(
      sampleToCellId({
        kind: 'gps',
        latitude: 20,
        longitude: 20,
        accuracyM: 100,
        capturedAt: 1,
      }),
    ).toEqual({
      cellId: null,
      accepted: false,
      reason: 'accuracy-too-low',
    })

    expect(
      sampleToCellId({
        kind: 'gps',
        latitude: 69,
        longitude: 50,
        accuracyM: 15,
        capturedAt: 1,
      }),
    ).toMatchObject({
      accepted: true,
      reason: 'gps',
    })
  })

  it('creates simulated walk samples and their neighborhood', () => {
    const samples = createSimulatedWalkSamples(['2-5', '3-5'], 1000, 500)

    expect(samples).toHaveLength(2)
    expect(samples[1].capturedAt).toBe(1500)
    expect(sampleNeighborhood(samples[0])).toContain('2-5')
  })
})
