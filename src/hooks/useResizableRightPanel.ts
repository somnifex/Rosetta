import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react"
import { clamp } from "@/lib/utils"

interface UseResizableRightPanelOptions {
  defaultWidth: number
  minWidth: number
  maxWidth: number
  storageKey?: string
}

function getViewportSafeMax(minWidth: number, configuredMax: number) {
  if (typeof window === "undefined") return configuredMax
  const safeMax = window.innerWidth - 120
  return Math.max(minWidth, Math.min(configuredMax, safeMax))
}

export function useResizableRightPanel({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
}: UseResizableRightPanelOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth

    const resolvedMax = getViewportSafeMax(minWidth, maxWidth)
    if (!storageKey) return clamp(defaultWidth, minWidth, resolvedMax)

    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    if (!Number.isFinite(parsed)) return clamp(defaultWidth, minWidth, resolvedMax)
    return clamp(parsed, minWidth, resolvedMax)
  })
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    if (!storageKey) return
    window.localStorage.setItem(storageKey, String(width))
  }, [storageKey, width])

  useEffect(() => {
    const handleViewportResize = () => {
      const resolvedMax = getViewportSafeMax(minWidth, maxWidth)
      setWidth((current) => clamp(current, minWidth, resolvedMax))
    }

    window.addEventListener("resize", handleViewportResize)
    return () => window.removeEventListener("resize", handleViewportResize)
  }, [maxWidth, minWidth])

  useEffect(() => {
    if (!isResizing) return

    const handleMove = (event: PointerEvent) => {
      const resolvedMax = getViewportSafeMax(minWidth, maxWidth)
      const nextWidth = clamp(window.innerWidth - event.clientX, minWidth, resolvedMax)
      setWidth(nextWidth)
    }

    const handleUp = () => {
      setIsResizing(false)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)

    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"

    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
    }
  }, [isResizing, maxWidth, minWidth])

  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    setIsResizing(true)
  }, [])

  const panelStyle = useMemo(
    () => ({ width: `${width}px` }),
    [width]
  )

  return {
    width,
    panelStyle,
    isResizing,
    startResize,
  }
}
