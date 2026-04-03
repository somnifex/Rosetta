import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import { useTranslation } from "react-i18next"
import type { CompareOrder } from "@/hooks/useReaderState"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer"
import { MineruLayoutViewer } from "@/components/viewer/MineruLayoutViewer"
import { TextSelectionToolbar } from "@/components/viewer/TextSelectionToolbar"
import { ArrowLeftRight, GripVertical } from "lucide-react"
import type { MineruLayoutPage } from "@/lib/mineru-layout"
import type { ReaderTextView } from "@/hooks/useReaderState"

interface ReaderComparePaneProps {
  originalContent: string
  translatedContent: string
  originalLayoutPages?: MineruLayoutPage[] | null
  translatedLayoutPages?: MineruLayoutPage[] | null
  originalFormat?: "markdown" | "plain"
  translatedFormat?: "markdown" | "plain"
  originalAssetBaseDir?: string | null
  translatedAssetBaseDir?: string | null
  textView?: ReaderTextView
  textScale: number
  compareRatio: number
  compareOrder: CompareOrder
  onCompareRatioChange: (ratio: number) => void
  onCompareOrderChange: (order: CompareOrder) => void
  onAskAI: (text: string) => void
  onTranslateSelection: (text: string) => void
}

function proportion(source: HTMLDivElement, target: HTMLDivElement) {
  const maxSource = source.scrollHeight - source.clientHeight
  const maxTarget = target.scrollHeight - target.clientHeight
  if (maxSource <= 0 || maxTarget <= 0) return 0
  return source.scrollTop / maxSource
}

export function ReaderComparePane({
  originalContent,
  translatedContent,
  originalLayoutPages,
  translatedLayoutPages,
  originalFormat = "markdown",
  translatedFormat = "markdown",
  originalAssetBaseDir,
  translatedAssetBaseDir,
  textView = "layout",
  textScale,
  compareRatio,
  compareOrder,
  onCompareRatioChange,
  onCompareOrderChange,
  onAskAI,
  onTranslateSelection,
}: ReaderComparePaneProps) {
  const { t } = useTranslation("document")
  const rootRef = useRef<HTMLDivElement>(null)
  const originalWrapperRef = useRef<HTMLDivElement>(null)
  const translatedWrapperRef = useRef<HTMLDivElement>(null)
  const originalScrollRef = useRef<HTMLDivElement>(null)
  const translatedScrollRef = useRef<HTMLDivElement>(null)
  const syncLockRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const showLayout =
    textView === "layout" &&
    !!originalLayoutPages?.length &&
    !!translatedLayoutPages?.length

  useEffect(() => {
    if (!dragging) return

    const handleMove = (event: MouseEvent) => {
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const nextRatio = (event.clientX - rect.left) / rect.width
      onCompareRatioChange(nextRatio)
    }

    const handleUp = () => setDragging(false)
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
  }, [dragging, onCompareRatioChange])

  const syncScroll = (
    sourceRef: RefObject<HTMLDivElement | null>,
    targetRef: RefObject<HTMLDivElement | null>
  ) => {
    if (syncLockRef.current) return
    const source = sourceRef.current
    const target = targetRef.current
    if (!source || !target) return

    syncLockRef.current = true
    const maxTarget = target.scrollHeight - target.clientHeight
    target.scrollTop = proportion(source, target) * maxTarget
    window.requestAnimationFrame(() => {
      syncLockRef.current = false
    })
  }

  const leftPane =
    compareOrder === "original-left"
      ? {
          title: t("reader.compare.original"),
          variant: "outline" as const,
          content: originalContent,
          layoutPages: originalLayoutPages,
          format: originalFormat,
          assetBaseDir: originalAssetBaseDir,
          wrapperRef: originalWrapperRef,
          scrollRef: originalScrollRef,
          onScroll: () => syncScroll(originalScrollRef, translatedScrollRef),
        }
      : {
          title: t("reader.compare.translated"),
          variant: "default" as const,
          content: translatedContent,
          layoutPages: translatedLayoutPages,
          format: translatedFormat,
          assetBaseDir: translatedAssetBaseDir,
          wrapperRef: translatedWrapperRef,
          scrollRef: translatedScrollRef,
          onScroll: () => syncScroll(translatedScrollRef, originalScrollRef),
        }

  const rightPane =
    compareOrder === "original-left"
      ? {
          title: t("reader.compare.translated"),
          variant: "default" as const,
          content: translatedContent,
          layoutPages: translatedLayoutPages,
          format: translatedFormat,
          assetBaseDir: translatedAssetBaseDir,
          wrapperRef: translatedWrapperRef,
          scrollRef: translatedScrollRef,
          onScroll: () => syncScroll(translatedScrollRef, originalScrollRef),
        }
      : {
          title: t("reader.compare.original"),
          variant: "outline" as const,
          content: originalContent,
          layoutPages: originalLayoutPages,
          format: originalFormat,
          assetBaseDir: originalAssetBaseDir,
          wrapperRef: originalWrapperRef,
          scrollRef: originalScrollRef,
          onScroll: () => syncScroll(originalScrollRef, translatedScrollRef),
        }

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="glass-surface flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{t("reader.compare.sync_scroll")}</Badge>
          <p className="text-xs text-muted-foreground">
            {t("reader.compare.parsed_notice")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="desktop-panel flex items-center gap-1 rounded-2xl border border-border/70 p-1">
            {[0.4, 0.5, 0.6].map((ratio) => (
              <Button
                key={ratio}
                variant="ghost"
                size="sm"
                className={cn(
                  "rounded-xl px-2.5 text-xs",
                  Math.abs(compareRatio - ratio) < 0.03 &&
                    "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                )}
                onClick={() => onCompareRatioChange(ratio)}
              >
                {Math.round(ratio * 100)}/{100 - Math.round(ratio * 100)}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl bg-background/70"
            onClick={() =>
              onCompareOrderChange(
                compareOrder === "original-left"
                  ? "translated-left"
                  : "original-left"
              )
            }
          >
            <ArrowLeftRight className="mr-1.5 h-4 w-4" />
            {t("reader.compare.swap_order")}
          </Button>
        </div>
      </div>

      <div ref={rootRef} className="flex flex-1 min-h-0 overflow-hidden">
        <div
          className="relative min-w-0 border-r bg-background/40"
          style={{ width: `${compareRatio * 100}%` }}
        >
          <TextSelectionToolbar
            containerRef={leftPane.wrapperRef}
            onAskAI={onAskAI}
            onTranslate={onTranslateSelection}
          />
          <div
            ref={leftPane.wrapperRef}
            className="flex h-full min-w-0 flex-col overflow-hidden"
          >
            <div className="glass-surface border-b px-4 py-2">
              <Badge variant={leftPane.variant}>{leftPane.title}</Badge>
            </div>
            {showLayout && leftPane.layoutPages?.length ? (
              <MineruLayoutViewer
                pages={leftPane.layoutPages}
                assetBaseDir={leftPane.assetBaseDir}
                textScale={textScale}
                containerRef={leftPane.scrollRef}
                onScroll={leftPane.onScroll}
                className="min-h-0"
              />
            ) : (
              <MarkdownViewer
                content={leftPane.content}
                contentFormat={leftPane.format}
                assetBaseDir={leftPane.assetBaseDir}
                textScale={textScale}
                containerRef={leftPane.scrollRef}
                onScroll={leftPane.onScroll}
                className="min-h-0"
              />
            )}
          </div>
        </div>

        <button
          type="button"
          className={cn(
            "group flex w-5 shrink-0 items-center justify-center border-r transition-colors",
            dragging ? "bg-primary/12" : "bg-muted/30 hover:bg-muted/60"
          )}
          onMouseDown={() => setDragging(true)}
        >
          <div
            className={cn(
              "rounded-full px-0.5 py-4 transition-colors",
              dragging
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground group-hover:bg-background/80"
            )}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        </button>

        <div className="relative min-w-0 flex-1 bg-background/30">
          <TextSelectionToolbar
            containerRef={rightPane.wrapperRef}
            onAskAI={onAskAI}
            onTranslate={onTranslateSelection}
          />
          <div
            ref={rightPane.wrapperRef}
            className="flex h-full min-w-0 flex-col overflow-hidden"
          >
            <div className="glass-surface border-b px-4 py-2">
              <Badge variant={rightPane.variant}>{rightPane.title}</Badge>
            </div>
            {showLayout && rightPane.layoutPages?.length ? (
              <MineruLayoutViewer
                pages={rightPane.layoutPages}
                assetBaseDir={rightPane.assetBaseDir}
                textScale={textScale}
                containerRef={rightPane.scrollRef}
                onScroll={rightPane.onScroll}
                className="min-h-0"
              />
            ) : (
              <MarkdownViewer
                content={rightPane.content}
                contentFormat={rightPane.format}
                assetBaseDir={rightPane.assetBaseDir}
                textScale={textScale}
                containerRef={rightPane.scrollRef}
                onScroll={rightPane.onScroll}
                className="min-h-0"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
