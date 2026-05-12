import type { StyleSpecification } from 'maplibre-gl'

const cityStylePath = `${import.meta.env.BASE_URL}city-style.json`
const numericComparisonOperators = new Set<string>(['<', '<=', '>', '>='])

type StyleExpression = [string, ...unknown[]]

let cachedCityStyle: Promise<StyleSpecification> | null = null
let originalFetch: typeof window.fetch | null = null
let isFetchPatched = false

function isCityStyleRequest(input: RequestInfo | URL) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  try {
    return new URL(value, window.location.href).pathname.endsWith('/city-style.json')
  } catch {
    return value.endsWith('city-style.json')
  }
}

function isExpression(value: unknown): value is StyleExpression {
  return Array.isArray(value) && typeof value[0] === 'string'
}

function sanitizeNumberExpression(value: unknown): unknown {
  if (isExpression(value) && value[0] === 'to-number') {
    const sanitizedArgs = value.slice(1).map(sanitizeStyleExpression)
    return sanitizedArgs.length >= 2 ? ['to-number', ...sanitizedArgs] : ['to-number', ...sanitizedArgs, 0]
  }

  if (isExpression(value) && value[0] === 'get') {
    return ['to-number', sanitizeStyleExpression(value), 0]
  }

  return sanitizeStyleExpression(value)
}

function sanitizeStyleExpression(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  if (!isExpression(value)) {
    return value.map(sanitizeStyleExpression)
  }

  const operator = value[0]

  if (operator === 'to-number') {
    const sanitizedArgs = value.slice(1).map(sanitizeStyleExpression)
    return sanitizedArgs.length >= 2 ? ['to-number', ...sanitizedArgs] : ['to-number', ...sanitizedArgs, 0]
  }

  if (numericComparisonOperators.has(operator)) {
    return [operator, sanitizeNumberExpression(value[1]), sanitizeNumberExpression(value[2]), ...value.slice(3).map(sanitizeStyleExpression)]
  }

  if (operator === 'interpolate' || operator === 'interpolate-hcl' || operator === 'interpolate-lab' || operator === 'step') {
    return [operator, sanitizeStyleExpression(value[1]), sanitizeNumberExpression(value[2]), ...value.slice(3).map(sanitizeStyleExpression)]
  }

  return value.map(sanitizeStyleExpression)
}

function sanitizeStyleValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return sanitizeStyleExpression(value)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeStyleValue(entry)]),
    )
  }

  return value
}

function sanitizeCityStyle(style: StyleSpecification): StyleSpecification {
  return sanitizeStyleValue(style) as StyleSpecification
}

export function loadCityStyle() {
  const fetcher = originalFetch ?? window.fetch.bind(window)

  cachedCityStyle ??= fetcher(cityStylePath)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load city style: ${response.status}`)
      }

      return response.json() as Promise<StyleSpecification>
    })
    .then(sanitizeCityStyle)

  return cachedCityStyle
}

export function installCityStyleFetchPatch() {
  if (isFetchPatched || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return
  }

  originalFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!isCityStyleRequest(input)) {
      return originalFetch!(input, init)
    }

    return loadCityStyle().then((style) => new Response(JSON.stringify(style), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }))
  }) as typeof window.fetch

  isFetchPatched = true
}
