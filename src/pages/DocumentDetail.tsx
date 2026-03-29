import { useState, useRef, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileText, Download, Trash2, Loader2, MessageSquare, ChevronDown } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { PdfViewer } from "@/components/viewer/PdfViewer"
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer"
import { TextSelectionToolbar } from "@/components/viewer/TextSelectionToolbar"
import { DocumentChatSidebar } from "@/components/document/DocumentChatSidebar"
import { TagPicker } from "@/components/document/TagPicker"

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation("document")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [chatOpen, setChatOpen] = useState(false)
  const [prefillText, setPrefillText] = useState("")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const viewerContainerRef = useRef<HTMLDivElement>(null)

  const { data: document, isLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => api.getDocumentById(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const currentDocument = query.state.data as {
        parse_status: string
        translation_status: string
        index_status: string
      } | undefined
      return currentDocument &&
        (
          currentDocument.parse_status === "parsing" ||
          currentDocument.translation_status === "translating" ||
          currentDocument.index_status === "indexing"
        )
        ? 2000
        : false
    },
  })

  const { data: parsedContent } = useQuery({
    queryKey: ["parsedContent", id],
    queryFn: () => api.getParsedContent(id!),
    enabled: !!id && document?.parse_status === "completed",
  })

  const { data: translatedContent } = useQuery({
    queryKey: ["translatedContent", id],
    queryFn: () => api.getTranslatedContent(id!),
    enabled: !!id && document?.translation_status === "completed",
  })

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.getCategories,
  })

  const { data: filePath } = useQuery({
    queryKey: ["documentFilePath", id],
    queryFn: () => api.getDocumentFilePath(id!),
    enabled: !!id && !!document && document.filename.toLowerCase().endsWith(".pdf"),
  })

  const { data: chunks = [] } = useQuery({
    queryKey: ["documentChunks", id],
    queryFn: () => api.getDocumentChunks(id!),
    enabled: !!id,
  })

  const startParseMutation = useMutation({
    mutationFn: api.startParseJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] })
      toast({ title: t("toast.parse_started.title"), description: t("toast.parse_started.description") })
    },
    onError: (error: any) => {
      toast({ title: t("toast.parse_error.title"), description: error.message, variant: "destructive" })
    },
  })

  const startTranslationMutation = useMutation({
    mutationFn: api.startTranslationJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] })
      toast({ title: t("toast.translation_started.title"), description: t("toast.translation_started.description") })
    },
    onError: (error: any) => {
      toast({ title: t("toast.translation_error.title"), description: error.message, variant: "destructive" })
    },
  })

  const startIndexMutation = useMutation({
    mutationFn: (data: { documentId: string; providerId: string }) =>
      api.startIndexJob(data.documentId, data.providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] })
      toast({ title: t("toast.index_started.title"), description: t("toast.index_started.description") })
    },
    onError: (error: any) => {
      toast({ title: t("toast.index_error.title"), description: error.message, variant: "destructive" })
    },
  })

  const exportMutation = useMutation({
    mutationFn: api.exportDocument,
    onSuccess: (path) => {
      toast({ title: t("toast.export_success.title"), description: t("toast.export_success.description", { path }) })
    },
    onError: (error: any) => {
      toast({ title: t("toast.export_error.title"), description: error.message, variant: "destructive" })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteDocument(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["parseJobs"] })
      queryClient.invalidateQueries({ queryKey: ["translationJobs"] })
      toast({ title: t("toast.delete_success.title") })
      navigate("/library")
    },
    onError: (error: any) => {
      toast({ title: t("toast.delete_error.title"), description: error.message, variant: "destructive" })
    },
  })

  const updateDocMutation = useMutation({
    mutationFn: api.updateDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] })
    },
  })

  const handleStartParsing = () => {
    if (document) startParseMutation.mutate(document.id)
  }

  const handleStartTranslation = () => {
    if (document && providers && providers.length > 0) {
      const activeProvider = providers.find((p) => p.is_active)
      if (!activeProvider) {
        toast({ title: tc("no_active_provider.title"), description: tc("no_active_provider.description"), variant: "destructive" })
        return
      }
      startTranslationMutation.mutate({
        documentId: document.id,
        providerId: activeProvider.id,
        sourceLanguage: document.source_language || "English",
        targetLanguage: document.target_language || "Chinese",
      })
    }
  }

  const handleStartIndexing = () => {
    if (document && providers && providers.length > 0) {
      const activeProvider = providers.find((p) => p.is_active)
      if (!activeProvider) {
        toast({ title: tc("no_active_provider.title"), description: tc("no_active_provider.description"), variant: "destructive" })
        return
      }
      startIndexMutation.mutate({ documentId: document.id, providerId: activeProvider.id })
    }
  }

  const handleExport = async (format: string) => {
    if (!document) return
    const { save } = await import("@tauri-apps/plugin-dialog")
    const extMap: Record<string, string> = { markdown: "md", txt: "txt", json: "json" }
    const ext = extMap[format] || "md"
    const filePath = await save({
      defaultPath: `${document.title}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    })
    if (filePath) {
      exportMutation.mutate({
        documentId: document.id,
        format,
        contentType: document.translation_status === "completed" ? "bilingual" : "original",
        outputPath: filePath,
      })
    }
  }

  const handleTextSelect = useCallback((_text: string) => {
    // Text selection is handled by TextSelectionToolbar
  }, [])

  const handleAskAI = useCallback((text: string) => {
    setPrefillText(`${t("selection.ask_about")}: "${text}"`)
    setChatOpen(true)
  }, [t])

  const handleTranslate = useCallback((text: string) => {
    setPrefillText(`${t("selection.translate_text")}: "${text}"`)
    setChatOpen(true)
  }, [t])

  const handleCategoryChange = (categoryId: string) => {
    if (document) {
      updateDocMutation.mutate({
        id: document.id,
        categoryId: categoryId === "none" ? undefined : categoryId,
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!document) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">{t("not_found")}</p>
      </div>
    )
  }

  const isPdf = document.filename.toLowerCase().endsWith(".pdf")
  const isMdOrTxt =
    document.filename.toLowerCase().endsWith(".md") ||
    document.filename.toLowerCase().endsWith(".txt") ||
    document.filename.toLowerCase().endsWith(".markdown")

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">{document.title}</h1>
            <p className="text-muted-foreground">{document.filename}</p>
            {/* Category selector */}
            <div className="flex items-center gap-2">
              <Select
                value={document.category_id || "none"}
                onValueChange={handleCategoryChange}
              >
                <SelectTrigger className="w-[180px] h-8 text-sm">
                  <SelectValue placeholder={t("category.select")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("category.none")}</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Tags */}
            <TagPicker documentId={document.id} />
          </div>
          <div className="flex gap-2 shrink-0">
            {document.parse_status === "completed" && document.index_status !== "completed" && (
              <Button variant="outline" onClick={handleStartIndexing} disabled={startIndexMutation.isPending}>
                {startIndexMutation.isPending ? t("btn.indexing") : t("btn.index")}
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setChatOpen(!chatOpen)}
              className={chatOpen ? "bg-primary/10 text-primary" : ""}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            {/* Export dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exportMutation.isPending}>
                  <Download className="mr-2 h-4 w-4" />
                  {exportMutation.isPending ? t("btn.exporting") : t("btn.export")}
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("markdown")}>Markdown (.md)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("txt")}>Plain Text (.txt)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("json")}>JSON (.json)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("btn.delete")}
            </Button>
          </div>
        </div>

        {/* Overview */}
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("overview.file_size")}</p>
              <p className="text-lg">{(document.file_size / 1024 / 1024).toFixed(2)} {tc("units.mb")}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("overview.pages")}</p>
              <p className="text-lg">{document.page_count}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("overview.parse_status")}</p>
              <Badge variant={
                document.parse_status === "completed" ? "default" :
                document.parse_status === "parsing" ? "secondary" :
                document.parse_status === "failed" ? "destructive" : "outline"
              }>
                {document.parse_status === "parsing" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {tc(`status.${document.parse_status as "pending" | "parsing" | "completed" | "failed"}`)}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("overview.translation_status")}</p>
              <Badge variant={
                document.translation_status === "completed" ? "default" :
                document.translation_status === "translating" ? "secondary" :
                document.translation_status === "failed" ? "destructive" : "outline"
              }>
                {document.translation_status === "translating" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {tc(`status.${document.translation_status as "pending" | "translating" | "completed" | "failed"}`)}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("overview.index_status")}</p>
              <Badge variant={
                document.index_status === "completed" ? "default" :
                document.index_status === "indexing" ? "secondary" :
                document.index_status === "failed" ? "destructive" : "outline"
              }>
                {document.index_status === "indexing" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {tc(`status.${document.index_status as "pending" | "indexing" | "completed" | "failed"}`)}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("overview.languages")}</p>
              <p className="text-sm">
                {document.source_language || t("overview.auto")} → {document.target_language || t("overview.not_set")}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="preview" className="w-full">
          <TabsList>
            <TabsTrigger value="preview">{t("tabs.preview")}</TabsTrigger>
            <TabsTrigger value="parsed">{t("tabs.parsed")}</TabsTrigger>
            <TabsTrigger value="translated">{t("tabs.translated")}</TabsTrigger>
            <TabsTrigger value="comparison">{t("tabs.comparison")}</TabsTrigger>
            <TabsTrigger value="structure">{t("tabs.structure")}</TabsTrigger>
            <TabsTrigger value="chunks">{t("tabs.chunks")}</TabsTrigger>
          </TabsList>

          {/* Preview Tab */}
          <TabsContent value="preview">
            <Card>
              <CardContent className="p-0 relative" ref={viewerContainerRef}>
                <TextSelectionToolbar
                  containerRef={viewerContainerRef}
                  onAskAI={handleAskAI}
                  onTranslate={handleTranslate}
                />
                {isPdf && filePath ? (
                  <div className="h-[600px]">
                    <PdfViewer fileUrl={filePath} onTextSelect={handleTextSelect} />
                  </div>
                ) : isMdOrTxt && parsedContent?.markdown_content ? (
                  <div className="h-[600px]">
                    <MarkdownViewer
                      content={parsedContent.markdown_content}
                      onTextSelect={handleTextSelect}
                    />
                  </div>
                ) : document.parse_status === "completed" && parsedContent?.markdown_content ? (
                  <div className="h-[600px]">
                    <MarkdownViewer
                      content={parsedContent.markdown_content}
                      onTextSelect={handleTextSelect}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">{t("placeholder.preview")}</p>
                      {document.parse_status === "pending" && (
                        <Button onClick={handleStartParsing} className="mt-4" disabled={startParseMutation.isPending}>
                          {startParseMutation.isPending ? t("btn.starting") : t("btn.start_parsing")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Parsed Tab */}
          <TabsContent value="parsed">
            <Card>
              <CardContent className="py-6">
                {document.parse_status === "completed" ? (
                  parsedContent ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <MarkdownViewer content={parsedContent.markdown_content} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  )
                ) : document.parse_status === "parsing" ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-muted-foreground">{t("parsed.in_progress")}</p>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">{t("parsed.not_started")}</p>
                    <Button onClick={handleStartParsing} disabled={startParseMutation.isPending}>
                      {startParseMutation.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("btn.starting")}</>
                      ) : (
                        t("btn.start_parsing")
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Translated Tab */}
          <TabsContent value="translated">
            <Card>
              <CardContent className="py-6">
                {document.translation_status === "completed" ? (
                  translatedContent ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <MarkdownViewer content={translatedContent.content} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  )
                ) : document.translation_status === "translating" ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-muted-foreground">{t("translated.in_progress")}</p>
                  </div>
                ) : document.parse_status !== "completed" ? (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">{t("translated.needs_parsing")}</p>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">{t("translated.not_started")}</p>
                    <Button onClick={handleStartTranslation} disabled={startTranslationMutation.isPending}>
                      {startTranslationMutation.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("btn.starting")}</>
                      ) : (
                        t("btn.start_translation")
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Comparison Tab */}
          <TabsContent value="comparison">
            <Card>
              <CardContent className="py-6">
                {parsedContent && translatedContent ? (
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Badge variant="outline">{t("comparison.original")}</Badge>
                      </h3>
                      <div className="border rounded-lg p-4 min-h-[400px] max-h-[600px] overflow-y-auto bg-muted/30">
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <MarkdownViewer content={parsedContent.markdown_content} />
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Badge variant="default">{t("comparison.translation")}</Badge>
                      </h3>
                      <div className="border rounded-lg p-4 min-h-[400px] max-h-[600px] overflow-y-auto bg-primary/5">
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <MarkdownViewer content={translatedContent.content} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">{t("comparison.unavailable")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Structure Tab */}
          <TabsContent value="structure">
            <Card>
              <CardContent className="py-6">
                {parsedContent?.structure_tree ? (
                  <div className="space-y-1">
                    {(() => {
                      try {
                        const tree = typeof parsedContent.structure_tree === "string"
                          ? JSON.parse(parsedContent.structure_tree)
                          : parsedContent.structure_tree
                        const renderNode = (node: any, depth: number = 0): React.ReactNode => {
                          if (!node) return null
                          if (Array.isArray(node)) {
                            return node.map((child, idx) => (
                              <div key={idx}>{renderNode(child, depth)}</div>
                            ))
                          }
                          return (
                            <div style={{ paddingLeft: `${depth * 20}px` }} className="py-0.5">
                              <span className="text-sm">
                                {node.title || node.text || node.name || JSON.stringify(node).slice(0, 100)}
                              </span>
                              {node.children && renderNode(node.children, depth + 1)}
                            </div>
                          )
                        }
                        return renderNode(tree)
                      } catch {
                        return <p className="text-sm text-muted-foreground whitespace-pre-wrap">{String(parsedContent.structure_tree)}</p>
                      }
                    })()}
                  </div>
                ) : (
                  <p className="text-muted-foreground">{t("placeholder.structure")}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Chunks Tab */}
          <TabsContent value="chunks">
            <Card>
              <CardContent className="py-6">
                {chunks.length > 0 ? (
                  <div className="space-y-3">
                    {chunks.map((chunk) => (
                      <div key={chunk.id} className="border rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">#{chunk.chunk_index}</Badge>
                          {chunk.page_number && (
                            <Badge variant="secondary" className="text-xs">
                              {t("chunks.page")} {chunk.page_number}
                            </Badge>
                          )}
                          {chunk.section_title && (
                            <span className="text-xs text-muted-foreground">{chunk.section_title}</span>
                          )}
                        </div>
                        <p className="text-sm whitespace-pre-wrap line-clamp-3">{chunk.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">{t("placeholder.chunks")}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Chat Sidebar */}
      <DocumentChatSidebar
        documentId={id!}
        documentTitle={document.title}
        documentContent={parsedContent?.markdown_content}
        isOpen={chatOpen}
        onToggle={() => setChatOpen(!chatOpen)}
        prefillText={prefillText}
        onPrefillConsumed={() => setPrefillText("")}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete_confirm.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("delete_confirm.description")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {tc("btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteMutation.mutate()
                setDeleteDialogOpen(false)
              }}
            >
              {t("btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
