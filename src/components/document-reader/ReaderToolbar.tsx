import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ReaderBaseMode, ReaderTextView } from "@/hooks/useReaderState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReaderModeSwitcher } from "@/components/document-reader/ReaderModeSwitcher"
import { cn } from "@/lib/utils"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Expand,
  Minimize,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

interface ReaderToolbarProps {
  title: string
  mode: ReaderBaseMode
  askOpen: boolean
  onModeChange: (mode: ReaderBaseMode) => void
  onAskToggle: () => void
  onBackToLibrary: () => void
  onOpenActions: () => void
  pageNumber?: number
  totalPages?: number
  scale?: number
  onPageChange?: (page: number) => void
  onScaleChange?: (scale: number) => void
  pageControlsDisabled?: boolean
  showScaleControls?: boolean
  showPageControls?: boolean
  originalView?: "pdf" | "parsed"
  onOriginalViewChange?: (view: "pdf" | "parsed") => void
  showOriginalViewToggle?: boolean
  textView?: ReaderTextView
  onTextViewChange?: (view: ReaderTextView) => void
  showTextViewToggle?: boolean
  layoutViewAvailable?: boolean
  modeDisabled?: Partial<Record<ReaderBaseMode | "ask", boolean>>
}

export function ReaderToolbar({
  title,
  mode,
  askOpen,
  onModeChange,
  onAskToggle,
  onBackToLibrary,
  onOpenActions: _onOpenActions,
  pageNumber,
  totalPages,
  scale,
  onPageChange,
  onScaleChange,
  pageControlsDisabled = false,
  showScaleControls = true,
  showPageControls = true,
  originalView = "pdf",
  onOriginalViewChange,
  showOriginalViewToggle = false,
  textView = "layout",
  onTextViewChange,
  showTextViewToggle = false,
  layoutViewAvailable = true,
  modeDisabled,
}: ReaderToolbarProps) {
  const { t } = useTranslation("document")
  const [fullScreen, setFullScreen] = useState(false)
  const [pageInput, setPageInput] = useState(pageNumber ? String(pageNumber) : "1")

  useEffect(() => {
    setPageInput(pageNumber ? String(pageNumber) : "1")
  }, [pageNumber])

  useEffect(() => {
    const handleChange = () => setFullScreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handleChange)
    return () => document.removeEventListener("fullscreenchange", handleChange)
  }, [])

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    await document.documentElement.requestFullscreen()
  }

  const canPage = !pageControlsDisabled && !!onPageChange && !!pageNumber && !!totalPages
  const showViewToggle = showOriginalViewToggle || showTextViewToggle

  return (
    <header className="glass-surface border-b border-border/70 px-4 py-2 shrink-0 relative z-20">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="shrink-0 rounded-xl bg-background/70" onClick={onBackToLibrary}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("reader.toolbar.back")}
        </Button>

        <div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 shadow-sm">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{title}</p>
            {showScaleControls ? (
              <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-border/60 bg-background/80 px-0.5 py-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() => onScaleChange?.((scale ?? 1) - 0.1)}
                  disabled={!onScaleChange}
                  aria-label={t("reader.toolbar.zoom_out")}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-[50px] text-center text-xs">{Math.round((scale ?? 1) * 100)}%</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() => onScaleChange?.((scale ?? 1) + 0.1)}
                  disabled={!onScaleChange}
                  aria-label={t("reader.toolbar.zoom_in")}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <ReaderModeSwitcher
          mode={mode}
          askOpen={askOpen}
          onModeChange={onModeChange}
          onAskToggle={onAskToggle}
          disabled={modeDisabled}
          className="w-full sm:w-[420px]"
        />

        <div className="w-full sm:w-[220px]">
          {showOriginalViewToggle ? (
            <div className="desktop-panel grid grid-cols-2 items-center gap-1 rounded-2xl border border-border/70 p-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full rounded-xl px-3 text-xs sm:text-sm",
                  originalView === "pdf" &&
                    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                )}
                onClick={() => onOriginalViewChange?.("pdf")}
              >
                PDF
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full rounded-xl px-3 text-xs sm:text-sm",
                  originalView === "parsed" &&
                    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                )}
                onClick={() => onOriginalViewChange?.("parsed")}
              >
                Layout
              </Button>
            </div>
          ) : showTextViewToggle ? (
            <div className="desktop-panel grid grid-cols-2 items-center gap-1 rounded-2xl border border-border/70 p-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full rounded-xl px-3 text-xs sm:text-sm",
                  textView === "layout" &&
                    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                )}
                onClick={() => onTextViewChange?.("layout")}
                disabled={!layoutViewAvailable}
              >
                Layout
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full rounded-xl px-3 text-xs sm:text-sm",
                  textView === "markdown" &&
                    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                )}
                onClick={() => onTextViewChange?.("markdown")}
              >
                Markdown
              </Button>
            </div>
          ) : (
            <div className={cn("hidden h-11 sm:block", !showViewToggle && "invisible")} />
          )}
        </div>

        {showPageControls ? (
          <div className="desktop-panel flex items-center gap-1 rounded-2xl border border-border/70 px-1 py-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl"
              onClick={() => canPage && onPageChange?.((pageNumber ?? 1) - 1)}
              disabled={!canPage || (pageNumber ?? 1) <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !canPage || !totalPages) return
                const nextPage = Number(pageInput)
                if (!Number.isFinite(nextPage)) return
                onPageChange?.(Math.max(1, Math.min(totalPages, Math.floor(nextPage))))
              }}
              disabled={!canPage}
              className="h-8 w-16 rounded-xl border-0 bg-transparent px-2 text-center shadow-none"
            />
            <span className="text-xs text-muted-foreground sm:text-sm">/ {totalPages || "-"}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl"
              onClick={() => canPage && onPageChange?.((pageNumber ?? 1) + 1)}
              disabled={!canPage || (!!totalPages && (pageNumber ?? 1) >= totalPages)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <Button variant="outline" size="icon" className="shrink-0 rounded-xl bg-background/70" onClick={toggleFullscreen}>
          {fullScreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  )
}
