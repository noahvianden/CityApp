import { useEffect, useRef, useState } from 'react'
import App from './App'
import './atlasFogOverlay.css'

type RevealPoint = {
  x: number
  y: number
}

const storageKey = 'cityapp:atlas-fog:v1'
const revealRadius = 86
const moveStep = 7

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function loadRevealPoints() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((point): point is RevealPoint => (
      Number.isFinite(point?.x) &&
      Number.isFinite(point?.y)
    ))
  } catch {
    return []
  }
}

function saveRevealPoints(points: RevealPoint[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(points.slice(-160)))
  } catch {
    // Local storage is optional for the fog prototype.
  }
}

function pointsAreNear(a: RevealPoint, b: RevealPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y) < 4.5
}

function estimateProgress(points: RevealPoint[]) {
  const columns = 10
  const rows = 10
  let revealed = 0

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const cell = { x: ((x + 0.5) / columns) * 100, y: ((y + 0.5) / rows) * 100 }
      const isRevealed = points.some((point) => Math.hypot(point.x - cell.x, point.y - cell.y) < 16)

      if (isRevealed) {
        revealed += 1
      }
    }
  }

  return Math.max(1, Math.min(100, Math.round(revealed)))
}

function drawFog(canvas: HTMLCanvasElement, points: RevealPoint[], activePoint: RevealPoint) {
  const rect = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  const width = Math.max(Math.round(rect.width * ratio), 1)
  const height = Math.max(Math.round(rect.height * ratio), 1)

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  context.clearRect(0, 0, width, height)
  context.fillStyle = 'rgba(28, 31, 30, 0.66)'
  context.fillRect(0, 0, width, height)
  context.globalCompositeOperation = 'destination-out'

  for (const point of points) {
    const x = (point.x / 100) * width
    const y = (point.y / 100) * height
    const gradient = context.createRadialGradient(x, y, 0, x, y, revealRadius * ratio)
    gradient.addColorStop(0, 'rgba(0,0,0,1)')
    gradient.addColorStop(0.72, 'rgba(0,0,0,0.92)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.beginPath()
    context.arc(x, y, revealRadius * ratio, 0, Math.PI * 2)
    context.fill()
  }

  context.globalCompositeOperation = 'source-over'
  context.strokeStyle = 'rgba(255, 246, 220, 0.45)'
  context.lineWidth = 2 * ratio
  context.beginPath()
  context.arc((activePoint.x / 100) * width, (activePoint.y / 100) * height, 18 * ratio, 0, Math.PI * 2)
  context.stroke()
}

function AtlasFogOverlay() {
  const [points, setPoints] = useState<RevealPoint[]>(() => {
    const storedPoints = loadRevealPoints()
    return storedPoints.length ? storedPoints : [{ x: 50, y: 50 }]
  })
  const [activePoint, setActivePoint] = useState<RevealPoint>(() => points.at(-1) ?? { x: 50, y: 50 })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const progress = estimateProgress(points)

  useEffect(() => {
    saveRevealPoints(points)
  }, [points])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const draw = () => drawFog(canvas, points, activePoint)
    draw()

    const resizeObserver = new ResizeObserver(draw)
    resizeObserver.observe(canvas)
    window.addEventListener('resize', draw)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', draw)
    }
  }, [activePoint, points])

  useEffect(() => {
    function reveal(point: RevealPoint) {
      setActivePoint(point)
      setPoints((current) => {
        if (current.some((candidate) => pointsAreNear(candidate, point))) {
          return current
        }

        return [...current, point]
      })
    }

    function move(direction: 'north' | 'east' | 'south' | 'west') {
      setActivePoint((current) => {
        const next = {
          x: clamp(current.x + (direction === 'east' ? moveStep : direction === 'west' ? -moveStep : 0), 6, 94),
          y: clamp(current.y + (direction === 'south' ? moveStep : direction === 'north' ? -moveStep : 0), 6, 94),
        }
        reveal(next)
        return next
      })
    }

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null
      const button = target?.closest('button')
      const label = button?.getAttribute('aria-label')?.toLowerCase() ?? ''

      if (label.includes('move gps north')) move('north')
      if (label.includes('move gps east')) move('east')
      if (label.includes('move gps south')) move('south')
      if (label.includes('move gps west')) move('west')

      const mapFrame = document.querySelector<HTMLElement>('.atlas-map-frame')
      if (mapFrame && mapFrame.contains(target) && !button) {
        const rect = mapFrame.getBoundingClientRect()
        reveal({
          x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
          y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
        })
      }
    }

    document.addEventListener('click', handleClick, true)

    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  return (
    <div className="atlas-fog-system" aria-hidden="true">
      <canvas ref={canvasRef} className="atlas-fog-canvas" />
      <div className="atlas-fog-progress">
        <span>{progress}% revealed</span>
        <strong>Keep exploring to reveal more of the city.</strong>
      </div>
    </div>
  )
}

export default function FoggedApp() {
  return (
    <>
      <App />
      <AtlasFogOverlay />
    </>
  )
}
