import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { open as openDialog, save } from "@tauri-apps/plugin-dialog"
import { api } from "@/lib/api"
import { getActiveProviderForType } from "@/lib/providers"
import type { DocumentOutput, Folder, MineruProcessedFile } from "../../../packages/types"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog"
import { DocumentMetadataPanel } from "./DocumentMetadataPanel"
import { ExtractFieldsDialog } from "./ExtractFieldsDialog"
import { TagPicker } from "@/components/document/TagPicker"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  BookOpen,
  Check,
  Circle,
  Download,
  Eye,
  FileCode2,
  FileOutput,
  FileText,
  FolderTree,
  Languages,
  Loader2,
  MoreHorizontal,
  PanelRightOpen,
  RefreshCcw,
  SearchCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

interface DocumentInfoDialogProps {
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatBytes(size: number) {
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(value?: string) {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

function getProgressBadge(
  status: string,
  progress: number | undefined,
  t: any
) {
  if (status === "failed") return <Badge variant="destructive">{t("document_info.status.failed")}</Badge>
  if (status === "completed") return <Badge>{t("document_info.status.completed")}</Badge>
  if (status === "pending") return <Badge variant="outline">{t("document_info.status.pending")}</Badge>
  if (status === "parsing" || status === "translating" || status === "indexing") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {progress !== undefined && progress > 0 ? `${Math.round(progress)}%` : t("document_info.status.processing")}
      </Badge>
    )
  }
  return <Badge variant="outline">{status}</Badge>
}

function StatusDot({ status }: { status: string }) {
  if (status === "completed") return <Check className="h-3 w-3 text-emerald-500" />
  if (status === "failed") return <AlertTriangle className="h-3 w-3 text-destructive" />
  if (["parsing", "translating", "indexing"].includes(status)) return <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
  return <Circle className="h-3 w-3 text-muted-foreground/40" />
}

function findOutput(outputs: DocumentOutput[], outputType: DocumentOutput["output_type"]) {
  return outputs.find((output) => output.output_type === outputType) ?? null
}

const MINERU_ARTIFACT_ORDER: MineruProcessedFile["artifact_type"][] = [
  "markdown",
  "html",
  "docx",
  "latex",
  "json",
  "structure",
  "archive",
]

function getMineruArtifactLabel(
  artifactType: MineruProcessedFile["artifact_type"],
  t: any
) {
  const keyMap: Record<MineruProcessedFile["artifact_type"], string> = {
    markdown: "document_info.artifacts.markdown",
    html: "document_info.artifacts.html",
    docx: "document_info.artifacts.docx",
    latex: "document_info.artifacts.latex",
    json: "document_info.artifacts.json",
    structure: "document_info.artifacts.structure",
    archive: "document_info.artifacts.archive",
  }
  return t(keyMap[artifactType] || "document_info.artifacts.archive")
}

function FolderSelect({
  folders,
  value,
  onChange,
}: {
  folders: Folder[]
  value: string | null | undefined
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation("library")
  return (
    <Select value={value ?? "root"} onValueChange={(nextValue) => onChange(nextValue === "root" ? null : nextValue)}>
      <SelectTrigger className="h-9 rounded-lg">
        <SelectValue placeholder={t("document_info.meta.root_folder")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="root">{t("document_info.meta.root_folder")}</SelectItem>
        {folders.map((folder) => (
          <SelectItem key={folder.id} value={folder.id}>
            {folder.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PdfPreview({
  fileUrl,
  onLoad,
  width = 120,
}: {
  fileUrl: string
  onLoad: (numPages: number) => void
  width?: number
}) {
  const assetUrl = useMemo(() => convertFileSrc(fileUrl), [fileUrl])
  const [loading, setLoading] = useState(true)

  return (
    <div className="pdf-preview-stage relative flex h-full items-center justify-center">
      {loading && <Loader2 className="absolute h-5 w-5 animate-spin text-muted-foreground" />}
      <Document
        file={assetUrl}
        onLoadSuccess={({ numPages }) => {
          onLoad(numPages)
          setLoading(false)
        }}
        onLoadError={() => setLoading(false)}
        loading={null}
      >
        <Page pageNumber={1} width={width} renderAnnotationLayer={false} renderTextLayer={false} />
      </Document>
    </div>
  )
}

export function DocumentInfoDialog({ documentId, open, onOpenChange }: DocumentInfoDialogProps) {
  const navigate = useNavigate()
  const { t } = useTranslation("library")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [thumbnailPages, setThumbnailPages] = useState<number | null>(null)
  const [confirmTrashOpen, setConfirmTrashOpen] = useState(false)
  const [extractDialogOpen, setExtractDialogOpen] = useState(false)

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["document", documentId] })
    queryClient.invalidateQueries({ queryKey: ["documents"] })
    queryClient.invalidateQueries({ queryKey: ["libraryDocuments"] })
    queryClient.invalidateQueries({ queryKey: ["documentOutputs", documentId] })
    queryClient.invalidateQueries({ queryKey: ["mineruProcessedFiles", documentId] })
    queryClient.invalidateQueries({ queryKey: ["parsedContent", documentId] })
    queryClient.invalidateQueries({ queryKey: ["translatedContent", documentId] })
    queryClient.invalidateQueries({ queryKey: ["documentChunks", documentId] })
    queryClient.invalidateQueries({ queryKey: ["documentMetadata", documentId] })
    queryClient.invalidateQueries({ queryKey: ["documentMetadataBatch"] })
    queryClient.invalidateQueries({ queryKey: ["parseJobs"] })
    queryClient.invalidateQueries({ queryKey: ["translationJobs"] })
  }

  const { data: document } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.getDocumentById(documentId!),
    enabled: !!documentId && open,
    refetchInterval: (query) => {
      const current = query.state.data as { parse_status: string; translation_status: string; index_status: string } | undefined
      return current && ["parsing", "translating", "indexing"].some((status) => [current.parse_status, current.translation_status, current.index_status].includes(status))
        ? 2000
        : false
    },
  })

  const { data: outputs = [] } = useQuery({
    queryKey: ["documentOutputs", documentId],
    queryFn: () => api.getDocumentOutputs(documentId!),
    enabled: !!documentId && open,
  })

  const { data: mineruProcessedFiles = [] } = useQuery({
    queryKey: ["mineruProcessedFiles", documentId],
    queryFn: () => api.getMineruProcessedFiles(documentId!),
    enabled: !!documentId && open,
  })

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.getCategories, enabled: open })
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: api.getFolders, enabled: open })
  const { data: providers = [] } = useQuery({ queryKey: ["providers"], queryFn: api.getProviders, enabled: open })
  const { data: parseJobs = [] } = useQuery({ queryKey: ["parseJobs"], queryFn: api.getAllParseJobs, enabled: open, refetchInterval: 3000 })
  const { data: translationJobs = [] } = useQuery({ queryKey: ["translationJobs"], queryFn: api.getAllTranslationJobs, enabled: open, refetchInterval: 3000 })

  const activeTranslateProvider = getActiveProviderForType(providers, "translate")
  const activeEmbedProvider = getActiveProviderForType(providers, "embed")
  const translatedPdf = findOutput(outputs, "translated_pdf")
  const sortedMineruArtifacts = useMemo(() => {
    const orderMap = new Map(
      MINERU_ARTIFACT_ORDER.map((artifactType, index) => [artifactType, index])
    )

    return [...mineruProcessedFiles].sort((left, right) => {
      const leftIndex = orderMap.get(left.artifact_type) ?? Number.MAX_SAFE_INTEGER
      const rightIndex = orderMap.get(right.artifact_type) ?? Number.MAX_SAFE_INTEGER
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
      return left.updated_at.localeCompare(right.updated_at)
    })
  }, [mineruProcessedFiles])

  const updateDocMutation = useMutation({
    mutationFn: api.updateDocument,
    onSuccess: invalidateAll,
    onError: (error: Error) => toast({ title: t("document_info.toast.document_update_error"), description: error.message, variant: "destructive" }),
  })

  const updateFolderMutation = useMutation({
    mutationFn: (folderId: string | null) => api.batchUpdateDocuments({ documentIds: [documentId!], folderId: folderId ?? "" }),
    onSuccess: invalidateAll,
    onError: (error: Error) => toast({ title: t("document_info.toast.folder_update_error"), description: error.message, variant: "destructive" }),
  })

  const parseMutation = useMutation({
    mutationFn: () => api.startParseJob(documentId!),
    onSuccess: () => {
      invalidateAll()
      toast({ title: t("document_info.toast.parse_started") })
    },
    onError: (error: Error) => toast({ title: t("document_info.toast.parse_start_error"), description: error.message, variant: "destructive" }),
  })

  const translationMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error("Document not found")
      if (!activeTranslateProvider) throw new Error(t("document_info.toast.no_translate_provider"))
      return api.startTranslationJob({
        documentId: document.id,
        providerId: activeTranslateProvider.id,
        sourceLanguage: document.source_language || "English",
        targetLanguage: document.target_language || "Chinese",
      })
    },
    onSuccess: () => {
      invalidateAll()
      toast({ title: t("document_info.toast.translation_started") })
    },
    onError: (error: Error) => toast({ title: t("document_info.toast.translation_start_error"), description: error.message, variant: "destructive" }),
  })

  const indexMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error("Document not found")
      if (!activeEmbedProvider) throw new Error(t("document_info.toast.no_embed_provider"))
      return api.startIndexJob(document.id, activeEmbedProvider.id)
    },
    onSuccess: () => {
      invalidateAll()
      toast({ title: t("document_info.toast.index_started") })
    },
    onError: (error: Error) => toast({ title: t("document_info.toast.index_start_error"), description: error.message, variant: "destructive" }),
  })

  const replaceOriginalMutation = useMutation({
    mutationFn: (filePath: string) => api.replaceOriginalDocumentFile(documentId!, filePath),
    onSuccess: () => {
      invalidateAll()
      toast({ title: t("document_info.toast.replace_original_success") })
    },
    onError: (error: Error) => toast({ title: t("document_info.toast.replace_original_error"), description: error.message, variant: "destructive" }),
  })

  const replaceTranslatedPdfMutation = useMutation({
    mutationFn: (filePath: string) => api.replaceTranslatedPdf(documentId!, filePath),
    onSuccess: () => {
      invalidateAll()
      toast({ title: t("document_info.toast.replace_translated_success") })
    },
    onError: (error: Error) => toast({ title: t("document_info.toast.replace_translated_error"), description: error.message, variant: "destructive" }),
  })

  const replaceMarkdownMutation = useMutation({
    mutationFn: (filePath: string) => api.replaceParsedMarkdown(documentId!, filePath),
    onSuccess: () => {
      invalidateAll()
      toast({ title: t("document_info.toast.replace_markdown_success") })
    },
    onError: (error: Error) => toast({ title: t("document_info.toast.replace_markdown_error"), description: error.message, variant: "destructive" }),
  })

  const moveToTrashMutation = useMutation({
    mutationFn: () => api.moveDocumentsToTrash([documentId!]),
    onSuccess: () => {
      invalidateAll()
      setConfirmTrashOpen(false)
      onOpenChange(false)
      toast({ title: t("document_info.toast.move_to_trash_success") })
    },
    onError: (error: Error) => toast({ title: t("document_info.toast.move_to_trash_error"), description: error.message, variant: "destructive" }),
  })

  const handleExportText = async (contentType: "original" | "translated" | "bilingual", ext = "md", label = "Markdown") => {
    if (!document) return
    const outputPath = await save({
      defaultPath: `${document.title}.${ext}`,
      filters: [{ name: label, extensions: [ext] }],
    })
    if (!outputPath) return

    try {
      await api.exportDocument({
        documentId: document.id,
        format: ext === "md" ? "markdown" : ext,
        contentType,
        outputPath,
      })
      toast({ title: t("document_info.toast.export_success"), description: outputPath })
    } catch (error: any) {
      toast({ title: t("document_info.toast.export_error"), description: error.message, variant: "destructive" })
    }
  }

  const handleExportAsset = async (assetType: "original_pdf" | "translated_pdf", filename: string) => {
    if (!document) return
    const outputPath = await save({
      defaultPath: filename,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    })
    if (!outputPath) return

    try {
      await api.exportDocumentAsset({
        documentId: document.id,
        assetType,
        outputPath,
      })
      toast({ title: t("document_info.toast.export_success"), description: outputPath })
    } catch (error: any) {
      toast({ title: t("document_info.toast.export_error"), description: error.message, variant: "destructive" })
    }
  }

  const pickSingleFile = async (extensions: string[]) => {
    const result = await openDialog({
      multiple: false,
      filters: [{ name: "file", extensions }],
    })
    return typeof result === "string" ? result : null
  }

  const openReader = (mode?: string, originalView?: "pdf" | "parsed") => {
    if (!documentId) return
    onOpenChange(false)
    const params = new URLSearchParams()
    if (mode) params.set("mode", mode)
    if (originalView === "parsed") params.set("originalView", "parsed")
    const query = params.toString()
    navigate(query ? `/document/${documentId}?${query}` : `/document/${documentId}`, {
      state: {
        source: "library",
        documentId,
      },
    })
  }

  const handleOpenOriginalFile = async () => {
    if (!document) return
    try {
      const shell = await import("@tauri-apps/plugin-shell")
      await shell.open(document.file_path)
    } catch (error: any) {
      toast({ title: t("document_info.toast.open_file_error"), description: error.message, variant: "destructive" })
    }
  }

  const openPathInSystem = async (path: string) => {
    try {
      const shell = await import("@tauri-apps/plugin-shell")
      await shell.open(path)
    } catch (error: any) {
      toast({ title: t("document_info.toast.open_file_error"), description: error.message, variant: "destructive" })
    }
  }

  const revealPathInSystem = async (path: string) => {
    try {
      await api.revealInOs(path)
    } catch (error: any) {
      toast({ title: t("document_info.toast.reveal_file_error"), description: error.message, variant: "destructive" })
    }
  }

  const parseJob = parseJobs.find((job) => job.document_id === documentId)
  const translationJob = translationJobs.find((job) => job.document_id === documentId)

  if (!document) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl p-0">
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const isPdf = document.filename.toLowerCase().endsWith(".pdf")
  const parseReady = document.parse_status === "completed"
  const translationReady = document.translation_status === "completed"
  const compareReady = parseReady && translationReady
  const askReady = parseReady
  const displayedPageCount = document.page_count > 0 ? document.page_count : thumbnailPages
  const recommendedAction = !parseReady
    ? {
        title: t("document_info.recommended.parse.title"),
        description: t("document_info.recommended.parse.description"),
        label: t("document_info.recommended.parse.label"),
        onClick: () => parseMutation.mutate(),
        disabled: parseMutation.isPending,
      }
    : !translationReady
      ? {
          title: t("document_info.recommended.translate.title"),
          description: t("document_info.recommended.translate.description"),
          label: t("document_info.recommended.translate.label"),
          onClick: () => translationMutation.mutate(),
          disabled: translationMutation.isPending,
        }
      : !translatedPdf
        ? {
            title: t("document_info.recommended.translated_pdf.title"),
            description: t("document_info.recommended.translated_pdf.description"),
            label: t("document_info.recommended.translated_pdf.label"),
            onClick: async () => {
              const filePath = await pickSingleFile(["pdf"])
              if (filePath) replaceTranslatedPdfMutation.mutate(filePath)
            },
            disabled: replaceTranslatedPdfMutation.isPending,
          }
        : {
            title: t("document_info.recommended.ready.title"),
            description: t("document_info.recommended.ready.description"),
            label: t("document_info.recommended.ready.label"),
            onClick: () => openReader(),
            disabled: false,
          }

  const readingActions = [
    {
      title: t("document_info.reading_actions.continue"),
      icon: BookOpen,
      onClick: () => openReader(),
      disabled: false,
      primary: true,
    },
    {
      title: t("document_info.reading_actions.original"),
      icon: Eye,
      onClick: () => openReader("original"),
      disabled: !isPdf && !parseReady,
    },
    {
      title: "Layout",
      icon: FileCode2,
      onClick: () => openReader("original", "parsed"),
      disabled: !parseReady,
    },
    {
      title: t("document_info.reading_actions.translated"),
      icon: Languages,
      onClick: () => openReader("translated"),
      disabled: !translationReady && !translatedPdf,
    },
    {
      title: t("document_info.reading_actions.compare"),
      icon: SearchCheck,
      onClick: () => openReader("compare"),
      disabled: !compareReady,
    },
    {
      title: t("document_info.reading_actions.ask"),
      icon: PanelRightOpen,
      onClick: () => openReader("ask"),
      disabled: !askReady,
    },
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="h-[88vh] max-h-[88vh] max-w-[820px] overflow-hidden border-0 bg-transparent p-0 shadow-none sm:rounded-xl [&>button]:hidden">
          <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">

            <div className="flex gap-5 border-b border-border px-6 py-5">
              <div className="flex h-[160px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/45">
                {isPdf && !document.is_file_missing ? (
                  <PdfPreview fileUrl={document.file_path} onLoad={setThumbnailPages} width={112} />
                ) : (
                  <FileText className="h-10 w-10 text-muted-foreground/50" />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-xl font-semibold leading-tight">{document.title}</h2>
                        {document.is_file_missing && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{document.filename}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg bg-background shadow-none">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={handleOpenOriginalFile}>{t("document_info.menu.open_original_file")}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExportText("bilingual", "md", "Markdown")} disabled={!compareReady}>
                            {t("document_info.menu.export_bilingual_markdown")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmTrashOpen(true)}>
                            {t("document_info.menu.move_to_trash")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => onOpenChange(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDate(document.created_at)}</span>
                    <span className="text-muted-foreground/45">|</span>
                    <span>{formatBytes(document.file_size)}</span>
                    <span className="text-muted-foreground/45">|</span>
                    <span>{displayedPageCount ? `${displayedPageCount} ${tc("units.pages")}` : t("document_info.meta.unknown_pages")}</span>
                    <span className="text-muted-foreground/45">|</span>
                    <span>{document.source_language || t("document_info.meta.auto_detect")} → {document.target_language || t("document_info.meta.not_set")}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={document.parse_status} />
                    <span>{t("document_info.meta.parse")}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={document.translation_status} />
                    <span>{t("document_info.meta.translation")}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={document.index_status} />
                    <span>{t("document_info.meta.index")}</span>
                  </div>
                  {document.is_file_missing && <Badge variant="destructive" className="rounded-full text-xs shadow-none">{t("document_info.meta.original_file_missing")}</Badge>}
                  {translatedPdf && <Badge className="rounded-full text-xs shadow-none">{t("document_info.meta.translated_pdf_ready")}</Badge>}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-6 py-3">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-medium">{recommendedAction.title}</span>
                <span className="text-muted-foreground">—</span>
                <span className="text-muted-foreground">{recommendedAction.description}</span>
              </div>
              <Button size="sm" className="shrink-0 rounded-lg" onClick={recommendedAction.onClick} disabled={recommendedAction.disabled}>
                {recommendedAction.label}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">

              <div className="border-b border-border px-6 py-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">{t("document_info.sections.reading_entries")}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {readingActions.map((action) => {
                    const Icon = action.icon
                    return (
                      <button
                        key={action.title}
                        type="button"
                        onClick={action.onClick}
                        disabled={action.disabled}
                        className={`group flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-all ${
                          action.primary
                            ? "border-primary/20 bg-primary text-primary-foreground hover:bg-primary/90"
                            : "border-border bg-background hover:border-border/90 hover:bg-muted"
                        } ${action.disabled ? "cursor-not-allowed opacity-40" : ""}`}
                      >
                        <div className={`rounded-md p-2 ${action.primary ? "bg-primary-foreground/15" : "bg-primary/8 text-primary"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-medium leading-tight">{action.title}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="px-6 py-5">
                <Tabs defaultValue="outputs" className="w-full">
                  <TabsList className="w-full justify-start rounded-lg">
                    <TabsTrigger value="outputs" className="rounded-md text-xs">{t("document_info.sections.outputs")}</TabsTrigger>
                    <TabsTrigger value="metadata" className="rounded-md text-xs">{t("document_info.sections.metadata")}</TabsTrigger>
                    <TabsTrigger value="archive" className="rounded-md text-xs">{t("document_info.sections.archive")}</TabsTrigger>
                    <TabsTrigger value="advanced" className="rounded-md text-xs">{t("document_info.sections.advanced")}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="outputs" className="mt-4 space-y-3">
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileOutput className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{t("document_info.outputs.original_pdf_title")}</p>
                          <p className="text-xs text-muted-foreground truncate">{isPdf && !document.is_file_missing ? t("document_info.outputs.original_pdf_available") : t("document_info.outputs.original_pdf_unavailable")}</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0 rounded-lg" disabled={!isPdf || !!document.is_file_missing} onClick={() => handleExportAsset("original_pdf", document.filename)}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        {t("document_info.buttons.export")}
                      </Button>
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <Languages className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{t("document_info.outputs.translated_pdf_title")}</p>
                          <p className="text-xs text-muted-foreground truncate">{translatedPdf ? t("document_info.outputs.translated_pdf_available") : t("document_info.outputs.translated_pdf_unavailable")}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={translatedPdf ? "secondary" : "outline"} className="rounded-full shadow-none text-xs font-normal">{translatedPdf ? t("document_info.outputs.provided") : t("document_info.outputs.not_provided")}</Badge>
                        <Button variant="outline" size="sm" className="rounded-lg" disabled={!translatedPdf || !!translatedPdf?.is_file_missing} onClick={() => handleExportAsset("translated_pdf", `${document.title}.translated.pdf`)}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          {t("document_info.buttons.export")}
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{t("document_info.outputs.markdown_title")}</p>
                          <p className="text-xs text-muted-foreground truncate">{parseReady ? t("document_info.outputs.markdown_available") : t("document_info.outputs.markdown_unavailable")}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={parseReady ? "secondary" : "outline"} className="rounded-full shadow-none text-xs font-normal">{parseReady ? t("document_info.outputs.generated") : t("document_info.outputs.not_generated")}</Badge>
                        <Button variant="outline" size="sm" className="rounded-lg" disabled={!parseReady} onClick={() => handleExportText("original", "md", "Markdown")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          {t("document_info.buttons.export")}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border p-3.5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{t("document_info.outputs.mineru_title")}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {t("document_info.outputs.mineru_description")}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={sortedMineruArtifacts.length > 0 ? "secondary" : "outline"}
                          className="rounded-full shadow-none text-xs font-normal"
                        >
                          {sortedMineruArtifacts.length > 0
                            ? t("document_info.outputs.mineru_count", { count: sortedMineruArtifacts.length })
                            : t("document_info.outputs.mineru_empty")}
                        </Badge>
                      </div>

                      {sortedMineruArtifacts.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {sortedMineruArtifacts.map((artifact) => (
                            <div
                              key={artifact.id}
                              className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  {getMineruArtifactLabel(artifact.artifact_type, t) || artifact.artifact_type}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {artifact.file_path}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg"
                                  disabled={!!artifact.is_file_missing}
                                  onClick={() => revealPathInSystem(artifact.file_path)}
                                >
                                  {t("document_info.buttons.reveal")}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg"
                                  disabled={!!artifact.is_file_missing}
                                  onClick={() => openPathInSystem(artifact.file_path)}
                                >
                                  {t("document_info.buttons.open")}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {t("document_info.outputs.mineru_empty_description")}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground">{t("document_info.pipeline.parse_result")}</p>
                        <div className="mt-2.5 flex items-center justify-between">
                          {getProgressBadge(document.parse_status, parseJob?.progress, t)}
                          <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => parseMutation.mutate()} disabled={parseMutation.isPending}>
                            <RefreshCcw className="mr-1 h-3 w-3" />
                            {t("document_info.buttons.retry")}
                          </Button>
                        </div>
                        {parseJob?.error_message ? <p className="mt-1.5 text-xs text-destructive">{parseJob.error_message}</p> : null}
                      </div>

                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground">{t("document_info.pipeline.translation_result")}</p>
                        <div className="mt-2.5 flex items-center justify-between">
                          {getProgressBadge(document.translation_status, translationJob?.progress, t)}
                          <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => translationMutation.mutate()} disabled={translationMutation.isPending || !parseReady}>
                            <RefreshCcw className="mr-1 h-3 w-3" />
                            {t("document_info.buttons.retry")}
                          </Button>
                        </div>
                        {translationJob?.error_message ? <p className="mt-1.5 text-xs text-destructive">{translationJob.error_message}</p> : null}
                      </div>

                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground">{t("document_info.pipeline.index_status")}</p>
                        <div className="mt-2.5 flex items-center justify-between">
                          {getProgressBadge(document.index_status, undefined, t)}
                          <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => indexMutation.mutate()} disabled={indexMutation.isPending || !parseReady}>
                            <RefreshCcw className="mr-1 h-3 w-3" />
                            {t("document_info.buttons.retry")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="metadata" className="mt-4">
                    <DocumentMetadataPanel
                      documentId={document.id}
                      onRequestExtract={() => setExtractDialogOpen(true)}
                    />
                  </TabsContent>

                  <TabsContent value="archive" className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{t("document_info.archive_section.category")}</p>
                        <Select
                          value={document.category_id || "none"}
                          onValueChange={(value) => updateDocMutation.mutate({ id: document.id, categoryId: value === "none" ? "" : value })}
                        >
                          <SelectTrigger className="h-9 rounded-lg">
                            <SelectValue placeholder={t("document_info.meta.uncategorized")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("document_info.meta.uncategorized")}</SelectItem>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <FolderTree className="h-4 w-4" />
                          {t("document_info.archive_section.folder")}
                        </p>
                        <FolderSelect
                          folders={folders}
                          value={document.folder_id || null}
                          onChange={(value) => updateFolderMutation.mutate(value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t("document_info.archive_section.tags")}</p>
                      <TagPicker documentId={document.id} />
                    </div>
                  </TabsContent>

                  <TabsContent value="advanced" className="mt-4 space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold">{t("document_info.advanced.maintenance_title")}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">{t("document_info.advanced.maintenance_description")}</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <Button
                          variant="outline"
                          className="h-10 justify-start rounded-lg shadow-none text-sm"
                          onClick={async () => {
                            const filePath = await pickSingleFile(["pdf"])
                            if (filePath) replaceOriginalMutation.mutate(filePath)
                          }}
                          disabled={replaceOriginalMutation.isPending}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          {t("document_info.advanced.replace_original_pdf")}
                        </Button>
                        <Button
                          variant="outline"
                          className="h-10 justify-start rounded-lg shadow-none text-sm"
                          onClick={async () => {
                            const filePath = await pickSingleFile(["pdf"])
                            if (filePath) replaceTranslatedPdfMutation.mutate(filePath)
                          }}
                          disabled={replaceTranslatedPdfMutation.isPending}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          {t("document_info.advanced.replace_translated_pdf")}
                        </Button>
                        <Button
                          variant="outline"
                          className="h-10 justify-start rounded-lg shadow-none text-sm"
                          onClick={async () => {
                            const filePath = await pickSingleFile(["md", "markdown", "txt"])
                            if (filePath) replaceMarkdownMutation.mutate(filePath)
                          }}
                          disabled={replaceMarkdownMutation.isPending}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          {t("document_info.advanced.replace_markdown")}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                      <h4 className="text-sm font-semibold text-destructive">{t("document_info.advanced.danger_title")}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">{t("document_info.advanced.danger_description")}</p>
                      <Button variant="destructive" size="sm" className="mt-3 rounded-lg shadow-none" onClick={() => setConfirmTrashOpen(true)}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        {t("document_info.advanced.move_to_trash")}
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={confirmTrashOpen}
        onOpenChange={setConfirmTrashOpen}
        title={t("document_info.confirm_trash.title")}
        description={t("document_info.confirm_trash.description")}
        confirmLabel={t("document_info.confirm_trash.confirm")}
        cancelLabel={t("document_info.confirm_trash.cancel")}
        loading={moveToTrashMutation.isPending}
        onConfirm={() => moveToTrashMutation.mutate()}
      />
      <ExtractFieldsDialog
        open={extractDialogOpen}
        documentIds={document ? [document.id] : []}
        onOpenChange={setExtractDialogOpen}
        onCompleted={invalidateAll}
      />
    </>
  )
}
