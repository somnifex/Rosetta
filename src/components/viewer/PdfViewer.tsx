import { useState, useCallback, useRef, useMemo } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from "lucide-react"
import { convertFileSrc } from "@tauri-apps/api/core"

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

interface PdfViewerProps {
  fileUrl: string
  onTextSelect?: (text: string) => void
}

export function PdfViewer({ fileUrl, onTextSelect }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const assetUrl = useMemo(() => convertFileSrc(fileUrl), [fileUrl])

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setLoading(false)
    setLoadError(null)
  }, [])

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error("PDF load error:", error)
    setLoading(false)
    setLoadError(error.message || "Failed to load PDF")
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (text && text.length > 0) {
      onTextSelect(text)
    }
  }, [onTextSelect])

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm min-w-[80px] text-center">
            {pageNumber} / {numPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setScale((s) => Math.min(3, s + 0.1))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex justify-center bg-muted/20 p-4"
        onMouseUp={handleMouseUp}
      >
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {loadError && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-destructive">{loadError}</p>
          </div>
        )}
        <Document
          file={assetUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null}
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>
    </div>
  )
}
