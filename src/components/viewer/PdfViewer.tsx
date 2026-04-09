import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { Check, CornerDownLeft, Loader2, RotateCcw, RotateCw, Save, ZoomIn, ZoomOut } from "lucide-react"
import { cn, clamp } from "@/lib/utils"
import { SK_PDF_ANNOTATIONS_PREFIX } from "@/lib/storage-keys"
import { useToast } from "@/hooks/use-toast"

interface PdfViewerProps {
  fileUrl: string
  fileName?: string
  scale?: number
  onScaleChange?: (scale: number) => void
  showZoomControls?: boolean
  onAskAI?: (text: string) => void
  onTranslateSelection?: (text: string) => void
  className?: string
}

const PDF_ANNOTATION_COLORS = ["#fde047", "#f97316", "#38bdf8", "#34d399"]
const MAX_HISTORY = 100

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

interface PdfHighlight {
  id: string
  pageIndex: number
  color: string
  createdAt: number
  selectors: {
    exact: string
    prefix: string
    suffix: string
    start: number
    end: number
  }
  rects: NormalizedRect[]
}

interface PersistedHighlights {
  version: 1
  highlights: PdfHighlight[]
}

interface PendingSelection {
  text: string
  pageGroups: Array<{
    pageIndex: number
    rects: NormalizedRect[]
  }>
  x: number
  y: number
}

function getAnnotationStorageKey(fileUrl: string) {
  return `${SK_PDF_ANNOTATIONS_PREFIX}${encodeURIComponent(fileUrl)}`
}

function getThemeMode(): "light" | "dark" {
  if (typeof window === "undefined") return "light" as const
  return window.document.documentElement.classList.contains("dark")
    ? "dark"
    : "light"
}

function clampZoom(value: number) {
  return clamp(value, 0.5, 3)
}

function clampNorm(value: number) {
  return clamp(value, 0, 1)
}

function toPersistedShape(value: unknown): PersistedHighlights {
  if (!value || typeof value !== "object") return { version: 1, highlights: [] }
  const parsed = value as Partial<PersistedHighlights>
  if (parsed.version !== 1 || !Array.isArray(parsed.highlights)) {
    return { version: 1, highlights: [] }
  }

  return {
    version: 1,
    highlights: parsed.highlights.filter((item) => {
      if (!item || typeof item !== "object") return false
      return Array.isArray(item.rects) && typeof item.pageIndex === "number"
    }),
  }
}

function readStoredHighlights(storageKey: string): PersistedHighlights {
  if (typeof window === "undefined") return { version: 1, highlights: [] }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { version: 1, highlights: [] }
    const parsed = JSON.parse(raw)

    // Older highlight data used an array at the root.
    if (Array.isArray(parsed)) {
      window.localStorage.setItem(`${storageKey}:legacy-backup`, raw)
      const migrated: PersistedHighlights = { version: 1, highlights: [] }
      window.localStorage.setItem(storageKey, JSON.stringify(migrated))
      return migrated
    }

    return toPersistedShape(parsed)
  } catch {
    return { version: 1, highlights: [] }
  }
}

export const PdfViewer = memo(function PdfViewer({
  fileUrl,
  fileName: _fileName,
  scale,
  onScaleChange,
  showZoomControls = true,
  onAskAI,
  onTranslateSelection,
  className,
}: PdfViewerProps) {
  const { t } = useTranslation("document")
  const { toast } = useToast()
  const shellRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const zoomThrottleRef = useRef(0)
  const draftRef = useRef<PdfHighlight[]>([])
  const askActionRef = useRef(onAskAI)
  const translateActionRef = useRef(onTranslateSelection)
  const [numPages, setNumPages] = useState(0)
  const [internalZoom, setInternalZoom] = useState(1.1)
    const zoom = scale ?? internalZoom

    const setZoomValue = useCallback((next: number | ((current: number) => number)) => {
      const current = zoom
      const rawNext = typeof next === "function" ? next(current) : next
      const clamped = clampZoom(rawNext)
      if (scale === undefined) {
        setInternalZoom(clamped)
      }
      onScaleChange?.(clamped)
    }, [onScaleChange, scale, zoom])

  const [savePending, setSavePending] = useState(false)
  const [selection, setSelection] = useState<PendingSelection | null>(null)
  const [undoStack, setUndoStack] = useState<PdfHighlight[][]>([])
  const [redoStack, setRedoStack] = useState<PdfHighlight[][]>([])
  const [themeMode, setThemeMode] = useState(getThemeMode)
  const assetUrl = useMemo(() => convertFileSrc(fileUrl), [fileUrl])
  const storageKey = useMemo(() => getAnnotationStorageKey(fileUrl), [fileUrl])
  const loaded = useMemo(() => readStoredHighlights(storageKey), [storageKey])
  const [savedHighlights, setSavedHighlights] = useState<PdfHighlight[]>(loaded.highlights)
  const [draftHighlights, setDraftHighlights] = useState<PdfHighlight[]>(loaded.highlights)

  useEffect(() => {
    const next = loaded.highlights
    setSavedHighlights(next)
    setDraftHighlights(next)
    setUndoStack([])
    setRedoStack([])
    setSelection(null)
  }, [loaded])

  useEffect(() => {
    draftRef.current = draftHighlights
  }, [draftHighlights])

  useEffect(() => {
    askActionRef.current = onAskAI
  }, [onAskAI])

  useEffect(() => {
    translateActionRef.current = onTranslateSelection
  }, [onTranslateSelection])

  useEffect(() => {
    if (typeof window === "undefined") return

    const observer = new MutationObserver(() => {
      setThemeMode(getThemeMode())
    })

    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [])

  const dirty = useMemo(
    () => JSON.stringify(draftHighlights) !== JSON.stringify(savedHighlights),
    [draftHighlights, savedHighlights]
  )

  const pushUndoSnapshot = useCallback((snapshot: PdfHighlight[]) => {
    setUndoStack((prev) => [...prev.slice(-(MAX_HISTORY - 1)), snapshot])
  }, [])

  const applyChange = useCallback((updater: (current: PdfHighlight[]) => PdfHighlight[]) => {
    setDraftHighlights((current) => {
      const next = updater(current)
      if (JSON.stringify(next) === JSON.stringify(current)) return current
      pushUndoSnapshot(current)
      setRedoStack([])
      return next
    })
  }, [pushUndoSnapshot])

  const saveHighlights = useCallback(() => {
    if (!dirty || typeof window === "undefined") return

    setSavePending(true)
    try {
      const payload: PersistedHighlights = {
        version: 1,
        highlights: draftRef.current,
      }
      window.localStorage.setItem(storageKey, JSON.stringify(payload))
      setSavedHighlights(draftRef.current)
      toast({
        title: t("reader_highlight.toast.save_success"),
      })
    } catch (error) {
      toast({
        title: t("reader_highlight.toast.save_error"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setSavePending(false)
    }
  }, [dirty, storageKey, t, toast])

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack
      const previous = stack[stack.length - 1]
      setRedoStack((redo) => [...redo.slice(-(MAX_HISTORY - 1)), draftRef.current])
      setDraftHighlights(previous)
      return stack.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack
      const next = stack[stack.length - 1]
      setUndoStack((undoHist) => [...undoHist.slice(-(MAX_HISTORY - 1)), draftRef.current])
      setDraftHighlights(next)
      return stack.slice(0, -1)
    })
  }, [])

  const updateZoom = useCallback((delta: number) => {
    setZoomValue((current) => current + delta)
  }, [setZoomValue])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName.toLowerCase()
      const isEditable =
        !!target?.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"

      if (isEditable || !(event.ctrlKey || event.metaKey)) return

      if (event.key.toLowerCase() === "s") {
        event.preventDefault()
        saveHighlights()
        return
      }

      if (event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
          return
        }
        undo()
        return
      }

      if (event.key === "=" || event.key === "+") {
        event.preventDefault()
        updateZoom(0.15)
        return
      }

      if (event.key === "-") {
        event.preventDefault()
        updateZoom(-0.15)
        return
      }

      if (event.key === "0") {
        event.preventDefault()
        setZoomValue(1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [redo, saveHighlights, setZoomValue, undo, updateZoom])

  const handleWheelCapture = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return

    event.preventDefault()

    const now = Date.now()
    if (now - zoomThrottleRef.current < 72) return
    zoomThrottleRef.current = now

    updateZoom(event.deltaY < 0 ? 0.15 : -0.15)
  }, [updateZoom])

  const onDocumentLoadSuccess = useCallback((next: { numPages: number }) => {
    setNumPages(next.numPages)
  }, [])

  const clearSelection = useCallback(() => {
    const selectionObj = window.getSelection()
    selectionObj?.removeAllRanges()
    setSelection(null)
  }, [])

  const handleMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest("[data-highlight-popover='true']")) return

    const selectionObj = window.getSelection()
    if (!selectionObj || selectionObj.rangeCount === 0) {
      setSelection(null)
      return
    }

    const text = selectionObj.toString().trim()
    if (!text) {
      setSelection(null)
      return
    }

    const range = selectionObj.getRangeAt(0)
    const rectList = Array.from(range.getClientRects())
    if (!rectList.length) {
      setSelection(null)
      return
    }

    const grouped = new Map<number, NormalizedRect[]>()
    for (const rect of rectList) {
      if (rect.width < 1 || rect.height < 1) continue

      let pageIndexFound = -1
      let pageBounds: DOMRect | null = null
      for (const [pageIndex, pageEl] of pageRefs.current.entries()) {
        const bounds = pageEl.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        if (centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom) {
          pageIndexFound = pageIndex
          pageBounds = bounds
          break
        }
      }

      if (pageIndexFound < 0 || !pageBounds || pageBounds.width <= 0 || pageBounds.height <= 0) continue

      const normalized: NormalizedRect = {
        x: clampNorm((rect.left - pageBounds.left) / pageBounds.width),
        y: clampNorm((rect.top - pageBounds.top) / pageBounds.height),
        width: clampNorm(rect.width / pageBounds.width),
        height: clampNorm(rect.height / pageBounds.height),
      }
      const list = grouped.get(pageIndexFound) ?? []
      list.push(normalized)
      grouped.set(pageIndexFound, list)
    }

    const pageGroups = Array.from(grouped.entries()).map(([pageIndex, rects]) => ({ pageIndex, rects }))
    if (!pageGroups.length) {
      setSelection(null)
      return
    }

    const firstRect = rectList[0]
    setSelection({
      text,
      pageGroups,
      x: firstRect.left,
      y: firstRect.top,
    })
  }, [])

  const createHighlight = useCallback((color: string) => {
    if (!selection) return
    const exact = selection.text
    const prefix = exact.slice(0, 20)
    const suffix = exact.slice(-20)

    applyChange((current) => {
      const createdAt = Date.now()
      const additions = selection.pageGroups.map((group, index) => ({
        id: `${createdAt}-${group.pageIndex}-${index}`,
        pageIndex: group.pageIndex,
        color,
        createdAt,
        selectors: {
          exact,
          prefix,
          suffix,
          start: 0,
          end: exact.length,
        },
        rects: group.rects,
      }))
      return [...current, ...additions]
    })
    clearSelection()
  }, [applyChange, clearSelection, selection])

  const handleAskSelection = useCallback(() => {
    if (!selection) return
    askActionRef.current?.(selection.text)
    clearSelection()
  }, [clearSelection, selection])

  const handleTranslateSelection = useCallback(() => {
    if (!selection) return
    translateActionRef.current?.(selection.text)
    clearSelection()
  }, [clearSelection, selection])

  return (
    <div
      ref={shellRef}
      className={cn("rosetta-pdf-shell relative min-h-0 flex-1 overflow-hidden", className)}
      onWheelCapture={handleWheelCapture}
      onMouseUp={handleMouseUp}
    >
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-2xl border border-border/70 bg-background/85 px-2 py-1 shadow-sm backdrop-blur">
        {showZoomControls ? (
          <>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => updateZoom(-0.15)}
              aria-label={t("reader_highlight.zoom_out")}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[58px] text-center text-xs font-medium">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => updateZoom(0.15)}
              aria-label={t("reader_highlight.zoom_in")}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
          </>
        ) : null}
        <button
          type="button"
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
          onClick={undo}
          disabled={!undoStack.length}
          aria-label={t("reader_highlight.undo")}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
          onClick={redo}
          disabled={!redoStack.length}
          aria-label={t("reader_highlight.redo")}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(
            "ml-1 inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium transition",
            dirty
              ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          )}
          onClick={saveHighlights}
          disabled={!dirty || savePending}
          aria-label={t("reader_highlight.save")}
        >
          {dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {dirty ? t("reader_highlight.unsaved") : t("reader_highlight.saved")}
        </button>
      </div>

      {selection ? (
        <div
          data-highlight-popover="true"
          className="fixed z-30 flex items-center gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-xl"
          style={{ left: selection.x, top: Math.max(8, selection.y - 40) }}
        >
          {PDF_ANNOTATION_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="h-6 w-6 rounded-full border border-border/80"
              style={{ backgroundColor: color }}
              onClick={() => createHighlight(color)}
              title={t("reader_highlight.add_highlight")}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={handleAskSelection}
          >
            {t("selection.ask_ai")}
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={handleTranslateSelection}
          >
            {t("selection.translate")}
          </button>
        </div>
      ) : null}

      <div className="rosetta-pdf-scroll h-full overflow-auto px-3 pb-8 pt-16">
        <div className="rosetta-pdf-stack mx-auto flex w-full max-w-[1180px] flex-col items-center gap-5">
          <Document
            file={assetUrl}
            loading={(
              <div className="flex h-[320px] items-center justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}
            onLoadSuccess={onDocumentLoadSuccess}
          >
            {Array.from({ length: numPages }, (_, idx) => {
              const pageIndex = idx + 1
              const highlightsForPage = draftHighlights.filter((item) => item.pageIndex === pageIndex)
              return (
                <div key={pageIndex} className="rosetta-pdf-page-group w-full">
                  <div
                    ref={(node) => {
                      if (node) pageRefs.current.set(pageIndex, node)
                      else pageRefs.current.delete(pageIndex)
                    }}
                    className={cn(
                      "rosetta-pdf-page-card rosetta-pdf-page-stage relative mx-auto overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm",
                      themeMode === "dark" ? "shadow-black/20" : "shadow-slate-200/80"
                    )}
                  >
                    <Page
                      pageNumber={pageIndex}
                      scale={zoom}
                      renderAnnotationLayer
                      renderTextLayer
                    />

                    <div className="pointer-events-none absolute inset-0 z-[3]">
                      {highlightsForPage.map((highlight) => (
                        <div key={highlight.id}>
                          {highlight.rects.map((rect, i) => (
                            <div
                              key={`${highlight.id}-${i}`}
                              className="absolute rounded-sm"
                              style={{
                                left: `${rect.x * 100}%`,
                                top: `${rect.y * 100}%`,
                                width: `${rect.width * 100}%`,
                                height: `${rect.height * 100}%`,
                                backgroundColor: highlight.color,
                                opacity: 0.35,
                              }}
                              title={highlight.selectors.exact}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              )
            })}
          </Document>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-xl border border-border/70 bg-background/85 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
        <span className="inline-flex items-center gap-1.5">
          <CornerDownLeft className="h-3.5 w-3.5" />
          {t("reader_highlight.shortcuts_hint")}
        </span>
      </div>
    </div>
  )
})
