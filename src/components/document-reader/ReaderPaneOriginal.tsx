import { useRef } from "react"
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer"
import { PdfViewer } from "@/components/viewer/PdfViewer"
import { TextSelectionToolbar } from "@/components/viewer/TextSelectionToolbar"
import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"

interface ReaderPaneOriginalProps {
  pdfPath?: string | null
  markdownContent?: string | null
  pageNumber: number
  scale: number
  textScale: number
  onPageChange: (page: number) => void
  onScaleChange: (scale: number) => void
  onDocumentLoad: (numPages: number) => void
  onAskAI: (text: string) => void
  onTranslateSelection: (text: string) => void
  className?: string
}

export function ReaderPaneOriginal({
  pdfPath,
  markdownContent,
  pageNumber,
  scale,
  textScale,
  onPageChange,
  onScaleChange,
  onDocumentLoad,
  onAskAI,
  onTranslateSelection,
  className,
}: ReaderPaneOriginalProps) {
  const viewerContainerRef = useRef<HTMLDivElement>(null)

  return (
    <section className={cn("relative flex h-full min-w-0 flex-col overflow-hidden", className)}>
      <TextSelectionToolbar
        containerRef={viewerContainerRef}
        onAskAI={onAskAI}
        onTranslate={onTranslateSelection}
      />

      <div ref={viewerContainerRef} className="flex-1 min-h-0 overflow-hidden">
        {pdfPath ? (
          <PdfViewer
            fileUrl={pdfPath}
            pageNumber={pageNumber}
            scale={scale}
            onPageChange={onPageChange}
            onScaleChange={onScaleChange}
            onDocumentLoad={onDocumentLoad}
            showControls={false}
            className="reader-noise h-full"
          />
        ) : markdownContent ? (
          <MarkdownViewer content={markdownContent} textScale={textScale} className="reader-noise h-full" contentClassName="prose-headings:tracking-tight prose-p:text-[1.02em]" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <FileText className="h-10 w-10" />
            <div>
              <p className="font-medium text-foreground">原文暂不可读</p>
              <p className="text-sm">请先完成解析，或检查原始文件是否仍然可用。</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
