import { useEffect, useState } from "react"
import type { ReaderBaseMode } from "@/hooks/useReaderState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReaderModeSwitcher } from "@/components/document-reader/ReaderModeSwitcher"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Expand,
  Minimize,
  PanelRightOpen,
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
  modeDisabled,
}: ReaderToolbarProps) {
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

  return (
    <header className="glass-surface border-b border-border/70 px-4 py-2 shrink-0 relative z-20">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="outline" size="sm" className="shrink-0 rounded-xl bg-background/70" onClick={onBackToLibrary}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          返回
        </Button>

        <div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 shadow-sm">
          <p className="truncate text-sm font-semibold">{title}</p>
        </div>

        <ReaderModeSwitcher
          mode={mode}
          askOpen={askOpen}
          onModeChange={onModeChange}
          onAskToggle={onAskToggle}
          disabled={modeDisabled}
        />

        {showScaleControls ? (
          <div className="desktop-panel flex items-center gap-1 rounded-2xl border border-border/70 px-1 py-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl"
              onClick={() => onScaleChange?.((scale ?? 1) - 0.1)}
              disabled={!onScaleChange}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="min-w-[54px] text-center text-xs sm:text-sm">
              {Math.round((scale ?? 1) * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl"
              onClick={() => onScaleChange?.((scale ?? 1) + 0.1)}
              disabled={!onScaleChange}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

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

        <Button variant="outline" size="sm" className="shrink-0 rounded-xl bg-background/70" onClick={onAskToggle}>
          <PanelRightOpen className="mr-1.5 h-4 w-4" />
          {askOpen ? "收起" : "问答"}
        </Button>

        <Button variant="outline" size="icon" className="shrink-0 rounded-xl bg-background/70" onClick={toggleFullscreen}>
          {fullScreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  )
}
