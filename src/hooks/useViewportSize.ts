import { useEffect, useState } from 'react'
import { getViewportSize, type ViewportSize } from '../appDomain'

export function useViewportSize() {
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize())

  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize(getViewportSize())
    }

    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)
    window.visualViewport?.addEventListener('resize', updateViewportSize)

    return () => {
      window.removeEventListener('resize', updateViewportSize)
      window.visualViewport?.removeEventListener('resize', updateViewportSize)
    }
  }, [])

  return viewportSize
}
