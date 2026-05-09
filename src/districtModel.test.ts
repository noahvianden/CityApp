import { describe, expect, it } from 'vitest'
import { cities } from './cityprintData'
import { describeDistrictResolution, getDistrictsForCell, getPrimaryDistrictForCell, resolveDistrictForCell } from './districtModel'

describe('district model', () => {
  it('resolves all district candidates for overlapping cells', () => {
    const berlin = cities[0]
    const districts = getDistrictsForCell(berlin, '4-2').map((district) => district.name)

    expect(districts).toEqual(['Market North', 'Old Center'])
    expect(getPrimaryDistrictForCell(berlin, '4-2')?.name).toBe('Market North')
  })

  it('uses authored place district as primary when a cell contains a place', () => {
    const berlin = cities[0]
    const resolution = resolveDistrictForCell(berlin, '4-4')

    expect(resolution.primaryDistrict?.name).toBe('Old Center')
    expect(resolution.candidateDistricts.map((district) => district.name)).toContain('Garden East')
    expect(resolution.placesInCell.map((place) => place.name)).toEqual(['Arcade House'])
    expect(describeDistrictResolution(resolution)).toContain('Arcade House')
  })

  it('returns no primary district for unmapped cells', () => {
    const berlin = cities[0]
    const resolution = resolveDistrictForCell(berlin, '6-7')

    expect(resolution.primaryDistrict).toBeNull()
    expect(resolution.candidateDistricts).toEqual([])
    expect(describeDistrictResolution(resolution)).toContain('not assigned')
  })
})
