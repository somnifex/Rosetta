import { useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer"
import { MineruLayoutViewer } from "@/components/viewer/MineruLayoutViewer"
import { PdfViewer } from "@/components/viewer/PdfViewer"
import { TextSelectionToolbar } from "@/components/viewer/TextSelectionToolbar"
import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { parseMineruLayout } from "@/lib/mineru-layout"

interface ReaderPaneOriginalProps {
  pdfPath?: string | null
  pdfFileName?: string
  pdfScale?: number
  onPdfScaleChange?: (scale: number) => void
  markdownContent?: string | null
  layoutJson?: string | null
  markdownBaseDir?: string | null
  contentFormat?: "markdown" | "plain"
  textScale: number
  onAskAI: (text: string) => void
  onTranslateSelection: (text: string) => void
  className?: string
}

export function ReaderPaneOriginal({
  pdfPath,
  pdfFileName,
  pdfScale,
  onPdfScaleChange,
  markdownContent,
  layoutJson,
  markdownBaseDir,
  contentFormat = "markdown",
  textScale,
  onAskAI,
  onTranslateSelection,
  className,
}: ReaderPaneOriginalProps) {
  const { t } = useTranslation("document")
  const viewerContainerRef = useRef<HTMLDivElement>(null)
  const layoutPages = useMemo(() => parseMineruLayout(layoutJson), [layoutJson])

  return (
    <section className={cn("relative flex h-full min-w-0 flex-col overflow-hidden", className)}>
      {pdfPath ? (
        <PdfViewer
          fileUrl={pdfPath}
          fileName={pdfFileName}
          scale={pdfScale}
          onScaleChange={onPdfScaleChange}
          showZoomControls={false}
          onAskAI={onAskAI}
          onTranslateSelection={onTranslateSelection}
          className="h-full"
        />
      ) : markdownContent ? (
        <>
          <TextSelectionToolbar
            containerRef={viewerContainerRef}
            onAskAI={onAskAI}
            onTranslate={onTranslateSelection}
          />

          <div ref={viewerContainerRef} className="flex-1 min-h-0 overflow-hidden">
            {layoutPages?.length ? (
              <MineruLayoutViewer
                pages={layoutPages}
                assetBaseDir={markdownBaseDir}
                textScale={textScale}
                className="h-full"
              />
            ) : (
              <MarkdownViewer
                content={markdownContent}
                contentFormat={contentFormat}
                assetBaseDir={markdownBaseDir}
                textScale={textScale}
                className="h-full"
                contentClassName="prose-headings:tracking-tight prose-p:text-[1.02em]"
              />
            )}
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <FileText className="h-10 w-10" />
          <div>
            <p className="font-medium text-foreground">{t("reader.empty.original_title")}</p>
            <p className="text-sm">{t("reader.empty.original_description")}</p>
          </div>
        </div>
      )}
    </section>
  )
}
