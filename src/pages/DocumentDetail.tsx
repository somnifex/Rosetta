import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useReaderState } from "@/hooks/useReaderState"
import { ReaderToolbar } from "@/components/document-reader/ReaderToolbar"
import { ReaderPaneOriginal } from "@/components/document-reader/ReaderPaneOriginal"
import { ReaderPaneTranslated } from "@/components/document-reader/ReaderPaneTranslated"
import { ReaderComparePane } from "@/components/document-reader/ReaderComparePane"
import { ReaderAskPanel } from "@/components/document-reader/ReaderAskPanel"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

function toModeQuery(baseMode: "original" | "translated" | "compare", askOpen: boolean) {
  if (baseMode === "compare" && askOpen) return "compare-ask"
  if (askOpen) return "ask"
  return baseMode
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [prefillText, setPrefillText] = useState("")

  const {
    state: readerState,
    setBaseMode,
    setAskOpen,
    setTextScale,
    setOriginalScale,
    setTranslatedScale,
    setCompareRatio,
    setCompareOrder,
  } = useReaderState(id || "", searchParams.get("mode"))

  const { data: document, isLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => api.getDocumentById(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const current = query.state.data as { parse_status: string; translation_status: string; index_status: string } | undefined
      return current && ["parsing", "translating", "indexing"].some((status) => [current.parse_status, current.translation_status, current.index_status].includes(status))
        ? 2000
        : false
    },
  })

  const { data: parsedContent, isFetching: isParsedContentFetching } = useQuery({
    queryKey: ["parsedContent", id],
    queryFn: () => api.getParsedContent(id!),
    enabled: !!id && !!document && document.parse_status === "completed",
  })

  const { data: translatedContent, isFetching: isTranslatedContentFetching } = useQuery({
    queryKey: ["translatedContent", id],
    queryFn: () => api.getTranslatedContent(id!),
    enabled: !!id && !!document && document.translation_status === "completed",
  })

  const { data: outputs = [] } = useQuery({
    queryKey: ["documentOutputs", id],
    queryFn: () => api.getDocumentOutputs(id!),
    enabled: !!id,
  })

  useEffect(() => {
    const nextMode = toModeQuery(readerState.baseMode, readerState.askOpen)
    if (searchParams.get("mode") === nextMode) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set("mode", nextMode)
      return next
    }, { replace: true })
  }, [readerState.askOpen, readerState.baseMode, searchParams, setSearchParams])

  useEffect(() => {
    window.scrollTo(0, 0)
    window.document.documentElement.scrollTop = 0
    window.document.body.scrollTop = 0
  }, [id])

  const translatedPdf = outputs.find((output) => output.output_type === "translated_pdf" && !output.is_file_missing)?.file_path
  const originalPdf = document && document.filename.toLowerCase().endsWith(".pdf") && !document.is_file_missing ? document.file_path : null
  const parseReady = document?.parse_status === "completed"
  const translationReady = document?.translation_status === "completed"
  const compareReady = !!parsedContent?.markdown_content && !!translatedContent?.content
  const originalContentLoading = parseReady && !originalPdf && isParsedContentFetching
  const translatedContentLoading = translationReady && !translatedPdf && isTranslatedContentFetching
  const compareContentLoading = parseReady && translationReady && (isParsedContentFetching || isTranslatedContentFetching)
  const prefersPlainTextLayout = !!document?.filename.toLowerCase().endsWith(".txt")
  const fallbackContentFormat = prefersPlainTextLayout ? "plain" : "markdown"
  const usesIntegratedPdfControls =
    (readerState.baseMode === "original" && !!originalPdf) ||
    (readerState.baseMode === "translated" && !!translatedPdf)
  const translatedPdfName = translatedPdf?.split(/[\\/]/).pop()

  const toolbarScale =
    readerState.baseMode === "original" && originalPdf
      ? readerState.originalScale
      : readerState.baseMode === "translated" && translatedPdf
      ? readerState.translatedScale
      : readerState.textScale

  const handleToolbarScaleChange = useCallback((scale: number) => {
    if (readerState.baseMode === "original" && originalPdf) {
      setOriginalScale(scale)
      return
    }
    if (readerState.baseMode === "translated" && translatedPdf) {
      setTranslatedScale(scale)
      return
    }
    setTextScale(scale)
  }, [originalPdf, readerState.baseMode, setOriginalScale, setTextScale, setTranslatedScale, translatedPdf])

  const handleAsk = useCallback((text: string) => {
    setPrefillText(`请结合当前文档解释这段内容：\n\n${text}`)
    setAskOpen(true)
  }, [setAskOpen])

  const handleTranslateSelection = useCallback((text: string) => {
    setPrefillText(`请翻译并解释这段内容：\n\n${text}`)
    setAskOpen(true)
  }, [setAskOpen])

  const handleBack = useCallback(() => {
    const state = window.history.state as { idx?: number } | null
    if ((state?.idx ?? 0) > 0) {
      navigate(-1)
      return
    }

    navigate("/library")
  }, [navigate])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName.toLowerCase()
      const isEditable = !!target?.isContentEditable || tagName === "textarea" || tagName === "input" || tagName === "select"
      if (isEditable) return

      if (event.key === "Escape" && readerState.askOpen) {
        event.preventDefault()
        setAskOpen(false)
        return
      }

      if (event.key === "1") {
        event.preventDefault()
        setBaseMode("original")
        return
      }

      if (event.key === "2" && (translationReady || !!translatedPdf)) {
        event.preventDefault()
        setBaseMode("translated")
        return
      }

      if (event.key === "3" && compareReady) {
        event.preventDefault()
        setBaseMode("compare")
        return
      }

      if (event.key === "4" && parseReady) {
        event.preventDefault()
        setAskOpen(!readerState.askOpen)
        return
      }

      if (!usesIntegratedPdfControls && (event.ctrlKey || event.metaKey)) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault()
          setTextScale(readerState.textScale + 0.1)
        }
        if (event.key === "-") {
          event.preventDefault()
          setTextScale(readerState.textScale - 0.1)
        }
        if (event.key === "0") {
          event.preventDefault()
          setTextScale(1)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    compareReady,
    parseReady,
    readerState.askOpen,
    readerState.textScale,
    setAskOpen,
    setBaseMode,
    setTextScale,
    translatedPdf,
    translationReady,
    usesIntegratedPdfControls,
  ])

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!document || !id) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <p className="text-muted-foreground">未找到文档</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">

      <ReaderToolbar
        title={document.title}
        mode={readerState.baseMode}
        askOpen={readerState.askOpen}
        onModeChange={setBaseMode}
        onAskToggle={() => setAskOpen(!readerState.askOpen)}
        onBackToLibrary={handleBack}
        onOpenActions={() => navigate("/library", { state: { reopenDocumentId: document.id } })}
        scale={toolbarScale}
        onScaleChange={handleToolbarScaleChange}
        showScaleControls={true}
        showPageControls={false}
        modeDisabled={{
          translated: !translationReady && !translatedPdf,
          compare: !compareReady,
          ask: !parseReady,
        }}
      />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex-1 overflow-hidden">
              {readerState.baseMode === "original" ? (
                originalContentLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <ReaderPaneOriginal
                    pdfPath={originalPdf}
                    pdfFileName={document.filename}
                    pdfScale={readerState.originalScale}
                    onPdfScaleChange={setOriginalScale}
                    markdownContent={parsedContent?.markdown_content}
                    contentFormat={fallbackContentFormat}
                    textScale={readerState.textScale}
                    onAskAI={handleAsk}
                    onTranslateSelection={handleTranslateSelection}
                  />
                )
              ) : null}

              {readerState.baseMode === "translated" ? (
                translatedContentLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <ReaderPaneTranslated
                    pdfPath={translatedPdf}
                    pdfFileName={translatedPdfName}
                    pdfScale={readerState.translatedScale}
                    onPdfScaleChange={setTranslatedScale}
                    markdownContent={translatedContent?.content}
                    contentFormat={fallbackContentFormat}
                    textScale={readerState.textScale}
                    onAskAI={handleAsk}
                    onTranslateSelection={handleTranslateSelection}
                  />
                )
              ) : null}

              {readerState.baseMode === "compare" ? (
                compareContentLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                  </div>
                ) : compareReady ? (
                  <ReaderComparePane
                    originalContent={parsedContent?.markdown_content || ""}
                    translatedContent={translatedContent?.content || ""}
                    originalFormat={fallbackContentFormat}
                    translatedFormat={fallbackContentFormat}
                    textScale={readerState.textScale}
                    compareRatio={readerState.compareRatio}
                    compareOrder={readerState.compareOrder}
                    onCompareRatioChange={setCompareRatio}
                    onCompareOrderChange={setCompareOrder}
                    onAskAI={handleAsk}
                    onTranslateSelection={handleTranslateSelection}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="rounded-[28px] border border-primary/10 bg-primary/5 px-8 py-7 shadow-sm">
                      <p className="text-lg font-medium">对照阅读尚未就绪</p>
                      <p className="mt-2 text-sm text-muted-foreground">完成解析和翻译后，这里会自动切换为左右对照阅读模式。</p>
                    </div>
                    <Button variant="outline" className="rounded-2xl bg-background/70" onClick={() => navigate("/library", { state: { reopenDocumentId: document.id } })}>
                      返回文档操作中心
                    </Button>
                  </div>
                )
              ) : null}
          </div>
        </main>

        <ReaderAskPanel
          documentId={document.id}
          documentTitle={document.title}
          isOpen={readerState.askOpen}
          onToggle={() => setAskOpen(!readerState.askOpen)}
          prefillText={prefillText}
          onPrefillConsumed={() => setPrefillText("")}
        />
      </div>

    </div>
  )
}
