import { useCallback, useRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface MarkdownViewerProps {
  content: string
  onTextSelect?: (text: string) => void
}

export function MarkdownViewer({ content, onTextSelect }: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (text && text.length > 0) {
      onTextSelect(text)
    }
  }, [onTextSelect])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto p-6"
      onMouseUp={handleMouseUp}
    >
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
