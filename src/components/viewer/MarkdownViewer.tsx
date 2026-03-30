import { useCallback } from "react"
import type { Ref, UIEventHandler } from "react"
import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "@/components/shared/MarkdownRenderer"

type MarkdownContentFormat = "markdown" | "plain"

interface MarkdownViewerProps {
  content: string
  onTextSelect?: (text: string) => void
  textScale?: number
  contentFormat?: MarkdownContentFormat
  containerRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
  className?: string
  contentClassName?: string
}

export function MarkdownViewer({
  content,
  onTextSelect,
  textScale = 1,
  contentFormat = "markdown",
  containerRef,
  onScroll,
  className,
  contentClassName,
}: MarkdownViewerProps) {
  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (text) onTextSelect(text)
  }, [onTextSelect])

  return (
    <div
      ref={containerRef}
      className={cn("reader-doc-surface flex-1 overflow-auto px-4 py-6 sm:px-6 lg:px-10", className)}
      onMouseUp={handleMouseUp}
      onScroll={onScroll}
    >
      <div className="mx-auto w-full max-w-[1040px]">
        <div className="reader-paper overflow-hidden rounded-[30px] border border-border/70 bg-background/90">
          {contentFormat === "plain" ? (
            <pre
              className="reader-plain-text px-6 py-7 sm:px-10 sm:py-10"
              style={{ fontSize: `${textScale}rem` }}
            >
              {content}
            </pre>
          ) : (
            <div
              className={cn(
                "px-6 py-7 sm:px-10 sm:py-10",
                contentClassName
              )}
              style={{ fontSize: `${textScale}rem` }}
            >
              <MarkdownRenderer content={content} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
