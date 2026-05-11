import { cities as allCities } from './cityprintData'

export const cities = allCities.filter((city) => city.id !== 'berlin')
