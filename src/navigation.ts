import type { City, Place } from './cityprintData'

export function buildExternalNavigationUrl(city: Pick<City, 'name' | 'country'>, place: Pick<Place, 'name' | 'district'>) {
  const query = [place.name, place.district, city.name, city.country].filter(Boolean).join(', ')

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
