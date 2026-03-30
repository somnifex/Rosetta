import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { open as openDialog, save } from "@tauri-apps/plugin-dialog"
import { api } from "@/lib/api"
import { getActiveProviderForType } from "@/lib/providers"
import type { DocumentOutput, Folder } from "../../../packages/types"
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

function getProgressBadge(status: string, progress?: number) {
  if (status === "failed") return <Badge variant="destructive">失败</Badge>
  if (status === "completed") return <Badge>已完成</Badge>
  if (status === "pending") return <Badge variant="outline">未开始</Badge>
  if (status === "parsing" || status === "translating" || status === "indexing") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {progress !== undefined && progress > 0 ? `${Math.round(progress)}%` : "处理中"}
      </Badge>
    )
  }
  return <Badge variant="outline">{status}</Badge>
}

/* Small status dot for the header row */
function StatusDot({ status }: { status: string }) {
  if (status === "completed") return <Check className="h-3 w-3 text-emerald-500" />
  if (status === "failed") return <AlertTriangle className="h-3 w-3 text-destructive" />
  if (["parsing", "translating", "indexing"].includes(status)) return <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
  return <Circle className="h-3 w-3 text-muted-foreground/40" />
}

function findOutput(outputs: DocumentOutput[], outputType: DocumentOutput["output_type"]) {
  return outputs.find((output) => output.output_type === outputType) ?? null
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
  return (
    <Select value={value ?? "root"} onValueChange={(nextValue) => onChange(nextValue === "root" ? null : nextValue)}>
      <SelectTrigger className="h-9 rounded-lg">
        <SelectValue placeholder="根目录" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="root">根目录</SelectItem>
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
    <div className="relative flex h-full items-center justify-center">
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
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [thumbnailPages, setThumbnailPages] = useState<number | null>(null)
  const [confirmTrashOpen, setConfirmTrashOpen] = useState(false)

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["document", documentId] })
    queryClient.invalidateQueries({ queryKey: ["documents"] })
    queryClient.invalidateQueries({ queryKey: ["libraryDocuments"] })
    queryClient.invalidateQueries({ queryKey: ["documentOutputs", documentId] })
    queryClient.invalidateQueries({ queryKey: ["parsedContent", documentId] })
    queryClient.invalidateQueries({ queryKey: ["translatedContent", documentId] })
    queryClient.invalidateQueries({ queryKey: ["documentChunks", documentId] })
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

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.getCategories, enabled: open })
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: api.getFolders, enabled: open })
  const { data: providers = [] } = useQuery({ queryKey: ["providers"], queryFn: api.getProviders, enabled: open })
  const { data: parseJobs = [] } = useQuery({ queryKey: ["parseJobs"], queryFn: api.getAllParseJobs, enabled: open, refetchInterval: 3000 })
  const { data: translationJobs = [] } = useQuery({ queryKey: ["translationJobs"], queryFn: api.getAllTranslationJobs, enabled: open, refetchInterval: 3000 })

  const activeTranslateProvider = getActiveProviderForType(providers, "translate")
  const activeEmbedProvider = getActiveProviderForType(providers, "embed")
  const translatedPdf = findOutput(outputs, "translated_pdf")

  const updateDocMutation = useMutation({
    mutationFn: api.updateDocument,
    onSuccess: invalidateAll,
    onError: (error: Error) => toast({ title: "文档信息更新失败", description: error.message, variant: "destructive" }),
  })

  const updateFolderMutation = useMutation({
    mutationFn: (folderId: string | null) => api.batchUpdateDocuments({ documentIds: [documentId!], folderId: folderId ?? "" }),
    onSuccess: invalidateAll,
    onError: (error: Error) => toast({ title: "文件夹更新失败", description: error.message, variant: "destructive" }),
  })

  const parseMutation = useMutation({
    mutationFn: () => api.startParseJob(documentId!),
    onSuccess: () => {
      invalidateAll()
      toast({ title: "已开始重新解析" })
    },
    onError: (error: Error) => toast({ title: "启动解析失败", description: error.message, variant: "destructive" }),
  })

  const translationMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error("Document not found")
      if (!activeTranslateProvider) throw new Error("未找到可用的翻译模型渠道")
      return api.startTranslationJob({
        documentId: document.id,
        providerId: activeTranslateProvider.id,
        sourceLanguage: document.source_language || "English",
        targetLanguage: document.target_language || "Chinese",
      })
    },
    onSuccess: () => {
      invalidateAll()
      toast({ title: "已开始翻译" })
    },
    onError: (error: Error) => toast({ title: "启动翻译失败", description: error.message, variant: "destructive" }),
  })

  const indexMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error("Document not found")
      if (!activeEmbedProvider) throw new Error("未找到可用的 embedding 模型渠道")
      return api.startIndexJob(document.id, activeEmbedProvider.id)
    },
    onSuccess: () => {
      invalidateAll()
      toast({ title: "已开始建立索引" })
    },
    onError: (error: Error) => toast({ title: "启动索引失败", description: error.message, variant: "destructive" }),
  })

  const replaceOriginalMutation = useMutation({
    mutationFn: (filePath: string) => api.replaceOriginalDocumentFile(documentId!, filePath),
    onSuccess: () => {
      invalidateAll()
      toast({ title: "原始 PDF 已替换，解析任务已自动重启" })
    },
    onError: (error: Error) => toast({ title: "替换原始 PDF 失败", description: error.message, variant: "destructive" }),
  })

  const replaceTranslatedPdfMutation = useMutation({
    mutationFn: (filePath: string) => api.replaceTranslatedPdf(documentId!, filePath),
    onSuccess: () => {
      invalidateAll()
      toast({ title: "翻译版 PDF 已更新" })
    },
    onError: (error: Error) => toast({ title: "替换翻译版 PDF 失败", description: error.message, variant: "destructive" }),
  })

  const replaceMarkdownMutation = useMutation({
    mutationFn: (filePath: string) => api.replaceParsedMarkdown(documentId!, filePath),
    onSuccess: () => {
      invalidateAll()
      toast({ title: "Markdown 已替换，相关翻译与索引状态已重置" })
    },
    onError: (error: Error) => toast({ title: "替换 Markdown 失败", description: error.message, variant: "destructive" }),
  })

  const moveToTrashMutation = useMutation({
    mutationFn: () => api.moveDocumentsToTrash([documentId!]),
    onSuccess: () => {
      invalidateAll()
      setConfirmTrashOpen(false)
      onOpenChange(false)
      toast({ title: "文档已移入回收站" })
    },
    onError: (error: Error) => toast({ title: "移入回收站失败", description: error.message, variant: "destructive" }),
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
      toast({ title: "导出成功", description: outputPath })
    } catch (error: any) {
      toast({ title: "导出失败", description: error.message, variant: "destructive" })
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
      toast({ title: "导出成功", description: outputPath })
    } catch (error: any) {
      toast({ title: "导出失败", description: error.message, variant: "destructive" })
    }
  }

  const pickSingleFile = async (extensions: string[]) => {
    const result = await openDialog({
      multiple: false,
      filters: [{ name: "file", extensions }],
    })
    return typeof result === "string" ? result : null
  }

  const openReader = (mode?: string) => {
    if (!documentId) return
    onOpenChange(false)
    navigate(mode ? `/document/${documentId}?mode=${mode}` : `/document/${documentId}`, {
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
      toast({ title: "打开文件失败", description: error.message, variant: "destructive" })
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
        title: "建议先完成解析",
        description: "解析完成后，原文阅读、翻译、对照和问答都会自动变得可用。",
        label: "立即解析",
        onClick: () => parseMutation.mutate(),
        disabled: parseMutation.isPending,
      }
    : !translationReady
      ? {
          title: "建议继续生成翻译",
          description: "翻译完成后可以直接进入翻译模式和对照阅读模式。",
          label: "开始翻译",
          onClick: () => translationMutation.mutate(),
          disabled: translationMutation.isPending,
        }
      : !translatedPdf
        ? {
            title: "可补充翻译版 PDF",
            description: "如果需要最终版面校对或导出 PDF，可以上传翻译版 PDF。",
            label: "上传翻译版 PDF",
            onClick: async () => {
              const filePath = await pickSingleFile(["pdf"])
              if (filePath) replaceTranslatedPdfMutation.mutate(filePath)
            },
            disabled: replaceTranslatedPdfMutation.isPending,
          }
        : {
            title: "阅读与交付都已就绪",
            description: "当前文档已经具备原文、翻译、对照和导出能力。",
            label: "继续阅读",
            onClick: () => openReader(),
            disabled: false,
          }

  const readingActions = [
    {
      title: "继续阅读",
      icon: BookOpen,
      onClick: () => openReader(),
      disabled: false,
      primary: true,
    },
    {
      title: "查看原文",
      icon: Eye,
      onClick: () => openReader("original"),
      disabled: !isPdf && !parseReady,
    },
    {
      title: "查看翻译",
      icon: Languages,
      onClick: () => openReader("translated"),
      disabled: !translationReady && !translatedPdf,
    },
    {
      title: "对照阅读",
      icon: SearchCheck,
      onClick: () => openReader("compare"),
      disabled: !compareReady,
    },
    {
      title: "阅读并提问",
      icon: PanelRightOpen,
      onClick: () => openReader("ask"),
      disabled: !askReady,
    },
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] max-w-[820px] overflow-hidden border-0 bg-transparent p-0 shadow-none sm:rounded-xl [&>button]:hidden">
          <div className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">

            {/* ── Header: Preview + Metadata ── */}
            <div className="flex gap-5 border-b border-border px-6 py-5">
              {/* PDF Thumbnail — compact */}
              <div className="flex h-[160px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-gray-50/60">
                {isPdf && !document.is_file_missing ? (
                  <PdfPreview fileUrl={document.file_path} onLoad={setThumbnailPages} width={112} />
                ) : (
                  <FileText className="h-10 w-10 text-muted-foreground/50" />
                )}
              </div>

              {/* Document info */}
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
                          <DropdownMenuItem onClick={handleOpenOriginalFile}>在系统中打开原文件</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExportText("bilingual", "md", "Markdown")} disabled={!compareReady}>
                            导出双语 Markdown
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmTrashOpen(true)}>
                            移入回收站
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => onOpenChange(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDate(document.created_at)}</span>
                    <span className="text-border">|</span>
                    <span>{formatBytes(document.file_size)}</span>
                    <span className="text-border">|</span>
                    <span>{displayedPageCount ? `${displayedPageCount} 页` : "页数未知"}</span>
                    <span className="text-border">|</span>
                    <span>{document.source_language || "自动识别"} → {document.target_language || "未设置"}</span>
                  </div>
                </div>

                {/* Status pills */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={document.parse_status} />
                    <span>解析</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={document.translation_status} />
                    <span>翻译</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={document.index_status} />
                    <span>索引</span>
                  </div>
                  {document.is_file_missing && <Badge variant="destructive" className="rounded-full text-xs shadow-none">原始文件缺失</Badge>}
                  {translatedPdf && <Badge className="rounded-full text-xs shadow-none">翻译版 PDF 已就绪</Badge>}
                </div>
              </div>
            </div>

            {/* ── Recommended Action Banner ── */}
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

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Reading Entries (horizontal) ── */}
              <div className="border-b border-border px-6 py-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">阅读入口</h3>
                <div className="grid grid-cols-5 gap-2">
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
                            : "border-border bg-background hover:border-gray-300 hover:bg-muted"
                        } ${action.disabled ? "cursor-not-allowed opacity-40" : ""}`}
                      >
                        <div className={`rounded-md p-2 ${action.primary ? "bg-white/14" : "bg-primary/8 text-primary"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-medium leading-tight">{action.title}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ── Tabbed sections ── */}
              <div className="px-6 py-5">
                <Tabs defaultValue="outputs" className="w-full">
                  <TabsList className="w-full justify-start rounded-lg">
                    <TabsTrigger value="outputs" className="rounded-md text-xs">输出与导出</TabsTrigger>
                    <TabsTrigger value="archive" className="rounded-md text-xs">归档与标注</TabsTrigger>
                    <TabsTrigger value="advanced" className="rounded-md text-xs">高级操作</TabsTrigger>
                  </TabsList>

                  {/* ── Tab: Outputs ── */}
                  <TabsContent value="outputs" className="mt-4 space-y-3">
                    {/* Original PDF */}
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileOutput className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">原文 PDF</p>
                          <p className="text-xs text-muted-foreground truncate">{isPdf && !document.is_file_missing ? "可直接导出原始 PDF" : "当前不是可导出的 PDF 文件"}</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0 rounded-lg" disabled={!isPdf || !!document.is_file_missing} onClick={() => handleExportAsset("original_pdf", document.filename)}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        导出
                      </Button>
                    </div>

                    {/* Translated PDF */}
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <Languages className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">翻译版 PDF</p>
                          <p className="text-xs text-muted-foreground truncate">{translatedPdf ? "已接入真实输出资产" : "尚未提供翻译版 PDF"}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={translatedPdf ? "secondary" : "outline"} className="rounded-full shadow-none text-xs font-normal">{translatedPdf ? "已准备" : "未提供"}</Badge>
                        <Button variant="outline" size="sm" className="rounded-lg" disabled={!translatedPdf || !!translatedPdf?.is_file_missing} onClick={() => handleExportAsset("translated_pdf", `${document.title}.translated.pdf`)}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          导出
                        </Button>
                      </div>
                    </div>

                    {/* Markdown */}
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Markdown</p>
                          <p className="text-xs text-muted-foreground truncate">{parseReady ? "解析后的 Markdown 已生成" : "完成解析后可导出 Markdown"}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={parseReady ? "secondary" : "outline"} className="rounded-full shadow-none text-xs font-normal">{parseReady ? "已生成" : "未生成"}</Badge>
                        <Button variant="outline" size="sm" className="rounded-lg" disabled={!parseReady} onClick={() => handleExportText("original", "md", "Markdown")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          导出
                        </Button>
                      </div>
                    </div>

                    {/* Pipeline status row */}
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground">解析结果</p>
                        <div className="mt-2.5 flex items-center justify-between">
                          {getProgressBadge(document.parse_status, parseJob?.progress)}
                          <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => parseMutation.mutate()} disabled={parseMutation.isPending}>
                            <RefreshCcw className="mr-1 h-3 w-3" />
                            重试
                          </Button>
                        </div>
                        {parseJob?.error_message ? <p className="mt-1.5 text-xs text-destructive">{parseJob.error_message}</p> : null}
                      </div>

                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground">翻译结果</p>
                        <div className="mt-2.5 flex items-center justify-between">
                          {getProgressBadge(document.translation_status, translationJob?.progress)}
                          <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => translationMutation.mutate()} disabled={translationMutation.isPending || !parseReady}>
                            <RefreshCcw className="mr-1 h-3 w-3" />
                            重试
                          </Button>
                        </div>
                        {translationJob?.error_message ? <p className="mt-1.5 text-xs text-destructive">{translationJob.error_message}</p> : null}
                      </div>

                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground">索引状态</p>
                        <div className="mt-2.5 flex items-center justify-between">
                          {getProgressBadge(document.index_status)}
                          <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => indexMutation.mutate()} disabled={indexMutation.isPending || !parseReady}>
                            <RefreshCcw className="mr-1 h-3 w-3" />
                            重试
                          </Button>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* ── Tab: Archive ── */}
                  <TabsContent value="archive" className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">分类</p>
                        <Select
                          value={document.category_id || "none"}
                          onValueChange={(value) => updateDocMutation.mutate({ id: document.id, categoryId: value === "none" ? "" : value })}
                        >
                          <SelectTrigger className="h-9 rounded-lg">
                            <SelectValue placeholder="未分类" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">未分类</SelectItem>
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
                          文件夹
                        </p>
                        <FolderSelect
                          folders={folders}
                          value={document.folder_id || null}
                          onChange={(value) => updateFolderMutation.mutate(value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">标签</p>
                      <TagPicker documentId={document.id} />
                    </div>
                  </TabsContent>

                  {/* ── Tab: Advanced ── */}
                  <TabsContent value="advanced" className="mt-4 space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold">替换与维护</h4>
                      <p className="mt-1 text-xs text-muted-foreground">替换文件会自动重置相关流水线任务。</p>
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
                          替换原版 PDF
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
                          替换翻译版 PDF
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
                          替换 Markdown
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                      <h4 className="text-sm font-semibold text-destructive">危险操作</h4>
                      <p className="mt-1 text-xs text-muted-foreground">删除不会直接永久清除，而是先进入回收站。</p>
                      <Button variant="destructive" size="sm" className="mt-3 rounded-lg shadow-none" onClick={() => setConfirmTrashOpen(true)}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        移入回收站
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
        title="移入回收站"
        description="这份文档将从文档库主视图移除，并进入回收站。相关阅读入口会随之关闭。"
        confirmLabel="确认移入"
        cancelLabel="取消"
        loading={moveToTrashMutation.isPending}
        onConfirm={() => moveToTrashMutation.mutate()}
      />
    </>
  )
}
