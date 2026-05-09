import { cities } from './cityprintData'
import { registerDynamicCityGeoBounds } from './cityGeoBounds'
import { loadGeneratedCityProfiles, readGeneratedCityRecords } from './generatedCityModel'

let bootstrapped = false

export function bootstrapGeneratedCities() {
  if (bootstrapped) {
    return
  }

  bootstrapped = true

  const records = readGeneratedCityRecords()
  const existingCityIds = new Set(cities.map((city) => city.id))
  const generatedProfiles = loadGeneratedCityProfiles().filter((city) => !existingCityIds.has(city.id))

  records.forEach((record) => {
    registerDynamicCityGeoBounds(record.id, record.bounds)
  })

  cities.splice(1, 0, ...generatedProfiles)
}
