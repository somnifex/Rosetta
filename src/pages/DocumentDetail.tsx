import { useEffect, useMemo, useState } from "react"
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
import { Loader2, PanelRightOpen } from "lucide-react"

function toModeQuery(baseMode: "original" | "translated" | "compare", askOpen: boolean) {
  if (baseMode === "compare" && askOpen) return "compare-ask"
  if (askOpen) return "ask"
  return baseMode
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [originalPages, setOriginalPages] = useState(0)
  const [translatedPages, setTranslatedPages] = useState(0)
  const [prefillText, setPrefillText] = useState("")

  const {
    state: readerState,
    setBaseMode,
    setAskOpen,
    setOriginalPage,
    setTranslatedPage,
    setOriginalScale,
    setTranslatedScale,
    setTextScale,
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

  const { data: parsedContent } = useQuery({
    queryKey: ["parsedContent", id],
    queryFn: () => api.getParsedContent(id!),
    enabled: !!id && !!document && document.parse_status === "completed",
  })

  const { data: translatedContent } = useQuery({
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

  const activePdfState = useMemo(() => {
    if (readerState.baseMode === "original" && originalPdf) {
      return {
        page: readerState.originalPage,
        totalPages: originalPages,
        scale: readerState.originalScale,
        onPageChange: setOriginalPage,
        onScaleChange: setOriginalScale,
      }
    }

    if (readerState.baseMode === "translated" && translatedPdf) {
      return {
        page: readerState.translatedPage,
        totalPages: translatedPages,
        scale: readerState.translatedScale,
        onPageChange: setTranslatedPage,
        onScaleChange: setTranslatedScale,
      }
    }

    return {
      page: undefined,
      totalPages: undefined,
      scale: readerState.textScale,
      onPageChange: undefined,
      onScaleChange: setTextScale,
    }
  }, [
    originalPages,
    originalPdf,
    readerState.baseMode,
    readerState.originalPage,
    readerState.originalScale,
    readerState.textScale,
    readerState.translatedPage,
    readerState.translatedScale,
    setOriginalPage,
    setOriginalScale,
    setTextScale,
    setTranslatedPage,
    setTranslatedScale,
    translatedPages,
    translatedPdf,
  ])

  const handleAsk = (text: string) => {
    setPrefillText(`请结合当前文档解释这段内容：\n\n${text}`)
    setAskOpen(true)
  }

  const handleTranslateSelection = (text: string) => {
    setPrefillText(`请翻译并解释这段内容：\n\n${text}`)
    setAskOpen(true)
  }

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

      if (activePdfState.onPageChange && activePdfState.page) {
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          activePdfState.onPageChange(activePdfState.page - 1)
          return
        }
        if (event.key === "ArrowRight") {
          event.preventDefault()
          activePdfState.onPageChange(activePdfState.page + 1)
          return
        }
      }

      if (activePdfState.onScaleChange && (event.ctrlKey || event.metaKey)) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault()
          activePdfState.onScaleChange((activePdfState.scale ?? 1) + 0.1)
        }
        if (event.key === "-") {
          event.preventDefault()
          activePdfState.onScaleChange((activePdfState.scale ?? 1) - 0.1)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    activePdfState,
    compareReady,
    parseReady,
    readerState.askOpen,
    setAskOpen,
    setBaseMode,
    translatedPdf,
    translationReady,
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
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-140px] top-[-100px] h-[340px] w-[340px] rounded-full bg-sky-200/25 blur-3xl" />
        <div className="absolute bottom-[-120px] right-[-60px] h-[300px] w-[300px] rounded-full bg-blue-200/20 blur-3xl" />
      </div>

      <ReaderToolbar
        title={document.title}
        mode={readerState.baseMode}
        askOpen={readerState.askOpen}
        onModeChange={setBaseMode}
        onAskToggle={() => setAskOpen(!readerState.askOpen)}
        onBackToLibrary={() => navigate("/library")}
        onOpenActions={() => navigate("/library", { state: { reopenDocumentId: document.id } })}
        pageNumber={activePdfState.page}
        totalPages={activePdfState.totalPages}
        scale={activePdfState.scale}
        onPageChange={activePdfState.onPageChange}
        onScaleChange={activePdfState.onScaleChange}
        pageControlsDisabled={!activePdfState.onPageChange}
        modeDisabled={{
          translated: !translationReady && !translatedPdf,
          compare: !compareReady,
          ask: !parseReady,
        }}
      />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
              {readerState.baseMode === "original" ? (
                <ReaderPaneOriginal
                  pdfPath={originalPdf}
                  markdownContent={parsedContent?.markdown_content}
                  pageNumber={readerState.originalPage}
                  scale={readerState.originalScale}
                  textScale={readerState.textScale}
                  onPageChange={setOriginalPage}
                  onScaleChange={setOriginalScale}
                  onDocumentLoad={setOriginalPages}
                  onAskAI={handleAsk}
                  onTranslateSelection={handleTranslateSelection}
                />
              ) : null}

              {readerState.baseMode === "translated" ? (
                <ReaderPaneTranslated
                  pdfPath={translatedPdf}
                  markdownContent={translatedContent?.content}
                  pageNumber={readerState.translatedPage}
                  scale={readerState.translatedScale}
                  textScale={readerState.textScale}
                  onPageChange={setTranslatedPage}
                  onScaleChange={setTranslatedScale}
                  onDocumentLoad={setTranslatedPages}
                  onAskAI={handleAsk}
                  onTranslateSelection={handleTranslateSelection}
                />
              ) : null}

              {readerState.baseMode === "compare" ? (
                compareReady ? (
                  <ReaderComparePane
                    originalContent={parsedContent?.markdown_content || ""}
                    translatedContent={translatedContent?.content || ""}
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

      {!readerState.askOpen && parseReady ? (
        <div className="pointer-events-none fixed bottom-5 right-5">
          <Button
            className="pointer-events-auto h-12 w-12 rounded-full shadow-[0_20px_40px_rgba(37,99,235,0.22)] ring-4 ring-white/70"
            size="icon"
            onClick={() => setAskOpen(true)}
          >
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
