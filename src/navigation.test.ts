import { describe, expect, it } from 'vitest'
import { buildExternalNavigationUrl } from './navigation'

describe('navigation', () => {
  it('builds an external maps search from city and place context', () => {
    const url = buildExternalNavigationUrl(
      { name: 'Berlin', country: 'Germany' },
      { name: 'Kaffee Linden', district: 'Old Center' },
    )

    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=Kaffee%20Linden%2C%20Old%20Center%2C%20Berlin%2C%20Germany',
    )
  })
})
