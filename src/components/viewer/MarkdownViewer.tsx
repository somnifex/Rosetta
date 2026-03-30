import { useCallback } from "react"
import type { Ref, UIEventHandler } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface MarkdownViewerProps {
  content: string
  onTextSelect?: (text: string) => void
  textScale?: number
  containerRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
  className?: string
  contentClassName?: string
}

export function MarkdownViewer({
  content,
  onTextSelect,
  textScale = 1,
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
      className={cn("flex-1 overflow-auto p-6", className)}
      onMouseUp={handleMouseUp}
      onScroll={onScroll}
    >
      <div
        className={cn("prose prose-sm max-w-none dark:prose-invert", contentClassName)}
        style={{ fontSize: `${textScale}rem` }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
