import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { api } from "@/lib/api"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog as ConfirmDialog,
  DialogContent as ConfirmDialogContent,
  DialogHeader as ConfirmDialogHeader,
  DialogTitle as ConfirmDialogTitle,
  DialogFooter as ConfirmDialogFooter,
} from "@/components/ui/dialog"
import {
  CheckCircle2,
  Clock,
  Columns2,
  Eye,
  RefreshCw,
  MoreHorizontal,
  Trash2,
  FileText,
  FileCode,
  FileType,
  Loader2,
  Download,
  ArrowUpFromLine,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// Configure PDF.js worker (idempotent, same as PdfViewer.tsx)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

interface DocumentInfoDialogProps {
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function PdfThumbnail({ fileUrl }: { fileUrl: string }) {
  const [loading, setLoading] = useState(true)
  const assetUrl = useMemo(() => convertFileSrc(fileUrl), [fileUrl])

  return (
    <div className="flex items-center justify-center">
      {loading && (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground absolute" />
      )}
      <Document
        file={assetUrl}
        onLoadSuccess={() => setLoading(false)}
        onLoadError={() => setLoading(false)}
        loading={null}
      >
        <Page
          pageNumber={1}
          width={180}
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      </Document>
    </div>
  )
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "md":
    case "markdown":
      return FileCode
    case "txt":
      return FileType
    default:
      return FileText
  }
}

export function DocumentInfoDialog({ documentId, open, onOpenChange }: DocumentInfoDialogProps) {
  const navigate = useNavigate()
  const { t } = useTranslation("document")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const { data: document } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.getDocumentById(documentId!),
    enabled: !!documentId && open,
  })

  const { data: filePath } = useQuery({
    queryKey: ["documentFilePath", documentId],
    queryFn: () => api.getDocumentFilePath(documentId!),
    enabled: !!documentId && open && !!document && document.filename.toLowerCase().endsWith(".pdf"),
  })

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
    enabled: open,
  })

  const startTranslationMutation = useMutation({
    mutationFn: api.startTranslationJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      toast({ title: t("toast.translation_started.title"), description: t("toast.translation_started.description") })
    },
    onError: (error: any) => {
      toast({ title: t("toast.translation_error.title"), description: error.message, variant: "destructive" })
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
    mutationFn: () => api.deleteDocument(documentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["parseJobs"] })
      queryClient.invalidateQueries({ queryKey: ["translationJobs"] })
      toast({ title: t("toast.delete_success.title") })
      onOpenChange(false)
    },
    onError: (error: any) => {
      toast({ title: t("toast.delete_error.title"), description: error.message, variant: "destructive" })
    },
  })

  const handleRetranslate = () => {
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

  const handleExportMarkdown = async () => {
    if (!document) return
    const { save } = await import("@tauri-apps/plugin-dialog")
    const outputPath = await save({
      defaultPath: `${document.title}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    })
    if (outputPath) {
      exportMutation.mutate({
        documentId: document.id,
        format: "markdown",
        contentType: document.translation_status === "completed" ? "bilingual" : "original",
        outputPath,
      })
    }
  }

  const handleViewOriginal = async () => {
    if (!filePath) return
    try {
      const { open: shellOpen } = await import("@tauri-apps/plugin-shell")
      await shellOpen(filePath)
    } catch {
      // Fallback: navigate to document detail preview tab
      onOpenChange(false)
      navigate(`/document/${documentId}`)
    }
  }

  const handleContinueView = () => {
    onOpenChange(false)
    navigate(`/document/${documentId}`)
  }

  const handleViewTranslated = () => {
    onOpenChange(false)
    navigate(`/document/${documentId}`)
  }

  if (!document) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl p-0">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const isPdf = document.filename.toLowerCase().endsWith(".pdf")
  const isTranslated = document.translation_status === "completed"
  const isParsed = document.parse_status === "completed"
  const uploadDate = new Date(document.created_at).toLocaleDateString()
  const Icon = getFileIcon(document.filename)

  return (
    <>
      <Dialog open={open && !deleteDialogOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden [&>button]:hidden">
          <div className="flex min-h-[480px]">
            {/* Left: Thumbnail */}
            <div className="w-[220px] shrink-0 bg-muted/40 border-r flex items-center justify-center p-4 relative">
              {isPdf && filePath ? (
                <PdfThumbnail fileUrl={filePath} />
              ) : (
                <Icon className="h-20 w-20 text-muted-foreground" />
              )}
            </div>

            {/* Right: Info */}
            <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-5 relative">
              {/* Three-dot menu */}
              <div className="absolute top-3 right-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("info_dialog.menu.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Title */}
              <div className="pr-10">
                <h2 className="text-xl font-bold leading-tight">{document.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("info_dialog.author_empty")}
                </p>
              </div>

              {/* Status + meta */}
              <div className="flex items-center gap-3">
                {isTranslated ? (
                  <Badge variant="default" className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("info_dialog.translation_complete")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {t("info_dialog.translation_incomplete")}
                  </Badge>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                {t("info_dialog.pages_uploaded", {
                  pages: document.page_count,
                  date: uploadDate,
                })}
              </p>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <Button variant="default" size="sm" onClick={handleContinueView}>
                  <Columns2 className="mr-2 h-4 w-4" />
                  {t("info_dialog.btn.continue_view")}
                </Button>
                <Button variant="outline" size="sm" onClick={handleViewOriginal} disabled={!isPdf || !filePath}>
                  <Eye className="mr-2 h-4 w-4" />
                  {t("info_dialog.btn.view_original")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetranslate}
                  disabled={!isParsed || startTranslationMutation.isPending}
                >
                  {startTranslationMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {t("info_dialog.btn.retranslate")}
                </Button>
              </div>

              {/* Divider */}
              <div className="border-t" />

              {/* Output results */}
              <div>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{t("info_dialog.outputs.title")}</p>
                  <p className="text-xs text-muted-foreground">{t("info_dialog.outputs.subtitle")}</p>
                </div>
                <div className="mt-3 space-y-3">
                  {/* Translated PDF row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{t("info_dialog.outputs.translated_pdf")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isTranslated ? "secondary" : "outline"} className="text-xs">
                        {isTranslated ? t("info_dialog.outputs.generated") : t("info_dialog.outputs.not_generated")}
                      </Badge>
                      {isTranslated && (
                        <Button variant="outline" size="sm" onClick={handleViewTranslated}>
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          {t("info_dialog.outputs.btn_view")}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Markdown row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{t("info_dialog.outputs.markdown")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isParsed ? "secondary" : "outline"} className="text-xs">
                        {isParsed ? t("info_dialog.outputs.extracted") : t("info_dialog.outputs.not_generated")}
                      </Badge>
                      {isParsed && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleExportMarkdown}
                          disabled={exportMutation.isPending}
                        >
                          <Download className="mr-1 h-3.5 w-3.5" />
                          {exportMutation.isPending ? t("btn.exporting") : t("info_dialog.outputs.btn_export")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t" />

              {/* More operations */}
              <div>
                <p className="font-semibold mb-2">{t("info_dialog.more.title")}</p>
                <div className="space-y-1">
                  <Button variant="ghost" className="w-full justify-start text-sm h-9" disabled>
                    <ArrowUpFromLine className="mr-2 h-4 w-4" />
                    {t("info_dialog.more.replace_original")}
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-sm h-9" disabled>
                    <ArrowUpFromLine className="mr-2 h-4 w-4" />
                    {t("info_dialog.more.replace_translated")}
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-sm h-9" disabled>
                    <ArrowUpFromLine className="mr-2 h-4 w-4" />
                    {t("info_dialog.more.replace_markdown")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("delete_confirm.title")}</ConfirmDialogTitle>
          </ConfirmDialogHeader>
          <p className="text-sm text-muted-foreground">{t("delete_confirm.description")}</p>
          <ConfirmDialogFooter>
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
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}
