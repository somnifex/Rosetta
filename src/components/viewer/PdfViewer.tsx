import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { cn } from "@/lib/utils"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

interface PdfViewerProps {
  fileUrl: string
  pageNumber?: number
  scale?: number
  onPageChange?: (page: number) => void
  onScaleChange?: (scale: number) => void
  onDocumentLoad?: (numPages: number) => void
  onTextSelect?: (text: string) => void
  showControls?: boolean
  className?: string
}

export function PdfViewer({
  fileUrl,
  pageNumber,
  scale,
  onPageChange,
  onScaleChange,
  onDocumentLoad,
  onTextSelect,
  showControls = true,
  className,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0)
  const [internalPage, setInternalPage] = useState(1)
  const [internalScale, setInternalScale] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const assetUrl = useMemo(() => convertFileSrc(fileUrl), [fileUrl])

  const currentPage = pageNumber ?? internalPage
  const currentScale = scale ?? internalScale

  useEffect(() => {
    setInternalPage(1)
    setLoading(true)
    setLoadError(null)
  }, [fileUrl])

  const updatePage = useCallback((nextPage: number) => {
    const safePage = Math.max(1, Math.min(numPages || nextPage, nextPage))
    if (pageNumber === undefined) setInternalPage(safePage)
    onPageChange?.(safePage)
  }, [numPages, onPageChange, pageNumber])

  const updateScale = useCallback((nextScale: number) => {
    const safeScale = Math.min(3, Math.max(0.5, nextScale))
    if (scale === undefined) setInternalScale(safeScale)
    onScaleChange?.(safeScale)
  }, [onScaleChange, scale])

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setLoading(false)
    setLoadError(null)
    onDocumentLoad?.(numPages)
    if (currentPage > numPages) updatePage(numPages)
  }, [currentPage, onDocumentLoad, updatePage])

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error("PDF load error:", error)
    setLoading(false)
    setLoadError(error.message || "Failed to load PDF")
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (text) onTextSelect(text)
  }, [onTextSelect])

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {showControls && (
        <div className="glass-surface flex items-center justify-between border-b px-4 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-xl bg-background/70"
              onClick={() => updatePage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[80px] text-center text-sm">
              {currentPage} / {numPages || "-"}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-xl bg-background/70"
              onClick={() => updatePage(currentPage + 1)}
              disabled={numPages > 0 && currentPage >= numPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-xl bg-background/70"
              onClick={() => updateScale(currentScale - 0.1)}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="min-w-[50px] text-center text-sm">
              {Math.round(currentScale * 100)}%
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-xl bg-background/70"
              onClick={() => updateScale(currentScale + 0.1)}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/30 p-3"
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

        <div className="flex justify-center">
          <Document
            file={assetUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={null}
          >
            <div className="rounded-xl bg-white shadow-md ring-1 ring-slate-200/60 dark:ring-slate-700/50">
              <Page
                pageNumber={currentPage}
                scale={currentScale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </div>
          </Document>
        </div>
      </div>
    </div>
  )
}
