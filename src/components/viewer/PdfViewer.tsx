import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react"
import type { IAnnotation, IConfig, IDocument } from "@iamjariwala/react-doc-viewer"
import { convertFileSrc } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface PdfViewerProps {
  fileUrl: string
  fileName?: string
  onAskAI?: (text: string) => void
  onTranslateSelection?: (text: string) => void
  className?: string
}

const PDF_ANNOTATION_COLORS = ["#fde047", "#f97316", "#38bdf8", "#34d399"]
const LazyPdfViewerRuntime = lazy(() => import("./PdfViewerRuntime"))

function getAnnotationStorageKey(fileUrl: string) {
  return `rosetta:pdf-annotations:${encodeURIComponent(fileUrl)}`
}

function getThemeMode(): "light" | "dark" {
  if (typeof window === "undefined") return "light" as const
  return window.document.documentElement.classList.contains("dark")
    ? "dark"
    : "light"
}

function getFileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || "document.pdf"
}

function readStoredAnnotations(storageKey: string, documentUri: string) {
  if (typeof window === "undefined") return [] as IAnnotation[]

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return [] as IAnnotation[]

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [] as IAnnotation[]

    return parsed.map((annotation) => ({
      ...annotation,
      documentUri,
    })) as IAnnotation[]
  } catch {
    return [] as IAnnotation[]
  }
}

export const PdfViewer = memo(function PdfViewer({
  fileUrl,
  fileName,
  onAskAI,
  onTranslateSelection,
  className,
}: PdfViewerProps) {
  const { t } = useTranslation("document")
  const shellRef = useRef<HTMLDivElement>(null)
  const zoomThrottleRef = useRef(0)
  const recoveryFrameIdsRef = useRef<number[]>([])
  const askActionRef = useRef(onAskAI)
  const translateActionRef = useRef(onTranslateSelection)
  const [themeMode, setThemeMode] = useState(getThemeMode)
  const assetUrl = useMemo(() => convertFileSrc(fileUrl), [fileUrl])
  const storageKey = useMemo(() => getAnnotationStorageKey(fileUrl), [fileUrl])
  const initialAnnotations = useMemo(
    () => readStoredAnnotations(storageKey, assetUrl),
    [assetUrl, storageKey]
  )

  useEffect(() => {
    askActionRef.current = onAskAI
  }, [onAskAI])

  useEffect(() => {
    translateActionRef.current = onTranslateSelection
  }, [onTranslateSelection])

  const selectionActions = useMemo(
    () =>
      [
        askActionRef.current
          ? {
              label: t("selection.ask_ai"),
              onClick: (selectedText: string) => askActionRef.current?.(selectedText),
            }
          : null,
        translateActionRef.current
          ? {
              label: t("selection.translate"),
              onClick: (selectedText: string) => translateActionRef.current?.(selectedText),
            }
          : null,
      ].filter((action): action is NonNullable<typeof action> => action !== null),
    [t]
  )

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

  const clearRecoveryFrames = useCallback(() => {
    for (const id of recoveryFrameIdsRef.current) {
      window.cancelAnimationFrame(id)
    }
    recoveryFrameIdsRef.current = []
  }, [])

  useEffect(() => clearRecoveryFrames, [clearRecoveryFrames])

  const persistAnnotations = useCallback((annotations: IAnnotation[]) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(storageKey, JSON.stringify(annotations))
  }, [storageKey])

  const dispatchViewerShortcut = useCallback((key: "+" | "-" | "0") => {
    const code =
      key === "0" ? "Digit0" : key === "-" ? "Minus" : "Equal"

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code,
        bubbles: true,
        cancelable: true,
        shiftKey: key === "+",
      })
    )
  }, [])

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

      if (event.key === "=" || event.key === "+") {
        event.preventDefault()
        dispatchViewerShortcut("+")
        return
      }

      if (event.key === "-") {
        event.preventDefault()
        dispatchViewerShortcut("-")
        return
      }

      if (event.key === "0") {
        event.preventDefault()
        dispatchViewerShortcut("0")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [dispatchViewerShortcut])

  const handleWheelCapture = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return

    event.preventDefault()

    const now = Date.now()
    if (now - zoomThrottleRef.current < 72) return
    zoomThrottleRef.current = now

    dispatchViewerShortcut(event.deltaY < 0 ? "+" : "-")
  }, [dispatchViewerShortcut])

  const recoverPaginationToggleLayout = useCallback((
    nextPaginated: boolean,
    currentPage: number,
    attempt = 0
  ) => {
    const shell = shellRef.current
    if (!shell) return

    // Reset unwanted scroll on overflow-hidden ancestors — the library may
    // trigger scrollIntoView during the mode toggle, shifting parent containers.
    const resetAncestorScroll = () => {
      for (let el: HTMLElement | null = shell.parentElement; el; el = el.parentElement) {
        if (el.scrollTop !== 0) el.scrollTop = 0
      }
    }
    resetAncestorScroll()

    const mainContent = shell.querySelector(".rdv-pdf-main-content")
    if (!(mainContent instanceof HTMLElement)) return

    const pageWrappers = shell.querySelectorAll(".rdv-pdf-page-wrapper")
    const modeReady = nextPaginated ? pageWrappers.length === 1 : pageWrappers.length > 1

    if (!modeReady && attempt < 10) {
      const id = window.requestAnimationFrame(() => {
        recoverPaginationToggleLayout(nextPaginated, currentPage, attempt + 1)
      })
      recoveryFrameIdsRef.current.push(id)
      return
    }

    if (nextPaginated) {
      mainContent.scrollTo({ top: 0, left: 0, behavior: "auto" })
    } else {
      const targetPage = pageWrappers[Math.max(0, currentPage - 1)]
      if (!(targetPage instanceof HTMLElement)) {
        mainContent.scrollTo({ top: 0, left: 0, behavior: "auto" })
      } else {
        const containerRect = mainContent.getBoundingClientRect()
        const pageRect = targetPage.getBoundingClientRect()
        const nextTop = Math.max(0, mainContent.scrollTop + pageRect.top - containerRect.top - 8)
        mainContent.scrollTo({ top: nextTop, left: 0, behavior: "auto" })
      }
    }

    // Schedule trailing resets to catch any delayed layout shifts from the library
    const scheduleTrailingResets = (count: number) => {
      if (count <= 0) return
      const id = window.requestAnimationFrame(() => {
        resetAncestorScroll()
        scheduleTrailingResets(count - 1)
      })
      recoveryFrameIdsRef.current.push(id)
    }
    scheduleTrailingResets(3)
  }, [])

  const handleMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest("#pdf-toggle-pagination")) return

    const shell = shellRef.current
    if (!shell) return

    clearRecoveryFrames()

    const currentPageInput = shell.querySelector("#pdf-pagination-input")
    const currentPage =
      currentPageInput instanceof HTMLInputElement && Number.isFinite(Number(currentPageInput.value))
        ? Math.max(1, Math.floor(Number(currentPageInput.value)))
        : 1

    const visiblePageCount = shell.querySelectorAll(".rdv-pdf-page-wrapper").length
    const nextPaginated = visiblePageCount > 1

    const id = window.requestAnimationFrame(() => {
      recoverPaginationToggleLayout(nextPaginated, currentPage)
    })
    recoveryFrameIdsRef.current.push(id)
  }, [clearRecoveryFrames, recoverPaginationToggleLayout])

  const config = useMemo<IConfig>(() => ({
    header: {
      disableHeader: true,
    },
    pdfZoom: {
      defaultZoom: 1.1,
      zoomJump: 0.15,
    },
    pdfVerticalScrollByDefault: true,
    loadingProgress: {
      enableProgressBar: true,
    },
    textSelection: {
      enableTextSelection: true,
    },
    keyboard: {
      enableKeyboardShortcuts: true,
    },
    search: {
      enableSearch: true,
    },
    bookmarks: {
      enableBookmarks: true,
    },
    thumbnail: {
      enableThumbnails: true,
      thumbnailWidth: 112,
      sidebarDefaultOpen: false,
    },
    annotations: {
      enableAnnotations: true,
      defaultColor: PDF_ANNOTATION_COLORS[0],
      colors: PDF_ANNOTATION_COLORS,
      tools: ["select", "highlight", "comment", "eraser"],
      initialAnnotations,
      onAnnotationChange: persistAnnotations,
    },
    selectionToolbar: {
      enabled: true,
      actions: selectionActions,
      showHighlightColors: true,
      showCopyButton: true,
      showCommentButton: true,
      colors: PDF_ANNOTATION_COLORS,
    },
    themeMode,
  }), [initialAnnotations, persistAnnotations, selectionActions, themeMode])

  const documents = useMemo<IDocument[]>(
    () => [
      {
        uri: assetUrl,
        fileName: fileName || getFileNameFromPath(fileUrl),
        fileType: "pdf",
      },
    ],
    [assetUrl, fileName, fileUrl]
  )

  return (
    <div
      ref={shellRef}
      className={cn("rosetta-pdf-shell min-h-0 flex-1 overflow-hidden", className)}
      onMouseDownCapture={handleMouseDownCapture}
      onWheelCapture={handleWheelCapture}
    >
      <Suspense
        fallback={(
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}
      >
        <LazyPdfViewerRuntime
          key={assetUrl}
          documents={documents}
          config={config}
        />
      </Suspense>
    </div>
  )
})
