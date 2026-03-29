import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { MessageSquare, Languages } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TextSelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>
  onAskAI: (text: string) => void
  onTranslate: (text: string) => void
}

export function TextSelectionToolbar({
  containerRef,
  onAskAI,
  onTranslate,
}: TextSelectionToolbarProps) {
  const { t } = useTranslation("document")
  const [selectedText, setSelectedText] = useState("")
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      // Delay hiding to allow clicking toolbar buttons
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) {
          setSelectedText("")
          setPosition(null)
        }
      }, 200)
      return
    }

    const text = selection.toString().trim()
    if (!text) return

    // Check if selection is within our container
    const container = containerRef.current
    if (!container) return

    const anchorNode = selection.anchorNode
    if (!anchorNode || !container.contains(anchorNode)) return

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    setSelectedText(text)
    setPosition({
      top: rect.top - containerRect.top - 42,
      left: rect.left - containerRect.left + rect.width / 2,
    })
  }, [containerRef])

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange)
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange)
    }
  }, [handleSelectionChange])

  if (!selectedText || !position) return null

  return (
    <div
      ref={toolbarRef}
      className="absolute z-50 flex items-center gap-1 bg-popover border rounded-lg shadow-lg p-1 -translate-x-1/2"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={() => {
          onAskAI(selectedText)
          window.getSelection()?.removeAllRanges()
          setSelectedText("")
          setPosition(null)
        }}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {t("selection.ask_ai")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={() => {
          onTranslate(selectedText)
          window.getSelection()?.removeAllRanges()
          setSelectedText("")
          setPosition(null)
        }}
      >
        <Languages className="h-3.5 w-3.5" />
        {t("selection.translate")}
      </Button>
    </div>
  )
}
