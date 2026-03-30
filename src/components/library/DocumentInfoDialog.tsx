import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { open as openDialog, save } from "@tauri-apps/plugin-dialog"
import { api } from "@/lib/api"
import type { DocumentOutput, Folder, Provider } from "../../../packages/types"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

function findActiveProvider(providers: Provider[] | undefined) {
  return providers?.find((provider) => provider.is_active) ?? null
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
      <SelectTrigger className="h-9 rounded-xl">
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
}: {
  fileUrl: string
  onLoad: (numPages: number) => void
}) {
  const assetUrl = useMemo(() => convertFileSrc(fileUrl), [fileUrl])
  const [loading, setLoading] = useState(true)

  return (
    <div className="relative flex h-full items-center justify-center">
      {loading && <Loader2 className="absolute h-6 w-6 animate-spin text-muted-foreground" />}
      <Document
        file={assetUrl}
        onLoadSuccess={({ numPages }) => {
          onLoad(numPages)
          setLoading(false)
        }}
        onLoadError={() => setLoading(false)}
        loading={null}
      >
        <Page pageNumber={1} width={260} renderAnnotationLayer={false} renderTextLayer={false} />
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

  const activeProvider = findActiveProvider(providers)
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
      if (!activeProvider) throw new Error("未找到可用的激活模型")
      return api.startTranslationJob({
        documentId: document.id,
        providerId: activeProvider.id,
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
      if (!activeProvider) throw new Error("未找到可用的激活模型")
      return api.startIndexJob(document.id, activeProvider.id)
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
        <DialogContent className="max-w-4xl p-0">
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
            description: "如果需要最终版面校对或导出 PDF，可以上传翻译版 PDF 作为阅读与导出资产。",
            label: "上传翻译版 PDF",
            onClick: async () => {
              const filePath = await pickSingleFile(["pdf"])
              if (filePath) replaceTranslatedPdfMutation.mutate(filePath)
            },
            disabled: replaceTranslatedPdfMutation.isPending,
          }
        : {
            title: "阅读与交付都已就绪",
            description: "当前文档已经具备原文、翻译、对照和导出能力，可以直接进入沉浸式工作区。",
            label: "继续阅读",
            onClick: () => openReader(),
            disabled: false,
          }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] max-w-[1160px] overflow-hidden border-0 bg-transparent p-0 shadow-none sm:rounded-[32px] [&>button]:hidden">
          <div className="relative grid min-h-[720px] grid-cols-[320px,minmax(0,1fr)] overflow-hidden rounded-[32px] border border-white/70 bg-background shadow-[0_40px_120px_rgba(15,23,42,0.22)]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-[-120px] top-[-60px] h-[280px] w-[280px] rounded-full bg-sky-200/30 blur-3xl" />
              <div className="absolute bottom-[-100px] right-[-80px] h-[260px] w-[260px] rounded-full bg-blue-200/20 blur-3xl" />
            </div>

            <section className="relative flex min-h-0 flex-col border-r bg-[linear-gradient(180deg,#f4f7fb_0%,#e9eef6_100%)]">
              <div className="flex items-center justify-between px-5 py-4">
                <Badge variant="outline" className="rounded-full bg-background/80">{isPdf ? "PDF" : "文本"}</Badge>
                {displayedPageCount ? <Badge className="rounded-full">{displayedPageCount} 页</Badge> : null}
              </div>

              <div className="flex-1 px-5 pb-5">
                <div className="reader-noise flex h-full min-h-[420px] items-center justify-center rounded-[28px] border border-white/60 bg-white/80 p-4 shadow-sm">
                  {isPdf && !document.is_file_missing ? (
                    <PdfPreview fileUrl={document.file_path} onLoad={setThumbnailPages} />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
                      <FileText className="mb-4 h-16 w-16" />
                      <p className="font-medium text-foreground">暂无首页缩略图</p>
                      <p className="mt-1 text-sm">可继续使用解析结果或原始文本进入阅读工作区</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t bg-background/70 px-5 py-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">解析</span>
                    {getProgressBadge(document.parse_status, parseJob?.progress)}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">翻译</span>
                    {getProgressBadge(document.translation_status, translationJob?.progress)}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">索引</span>
                    {getProgressBadge(document.index_status)}
                  </div>
                </div>
              </div>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden bg-background">
              <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-2xl font-semibold">{document.title}</h2>
                    {document.is_file_missing && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{document.filename}</p>
                  <p className="text-xs text-muted-foreground">作者：当前项目暂无结构化作者字段</p>
                  <div className="flex flex-wrap gap-2">
                    {document.category_name && <Badge variant="secondary">{document.category_name}</Badge>}
                    {document.folder_name && <Badge variant="secondary">{document.folder_name}</Badge>}
                    {translatedPdf && <Badge>翻译版 PDF 已就绪</Badge>}
                    {document.is_file_missing && <Badge variant="destructive">原始文件缺失</Badge>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="rounded-xl bg-background/70">
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
                  <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => onOpenChange(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  <section className="desktop-panel rounded-[28px] border border-border/70 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <Sparkles className="h-4 w-4 text-primary" />
                          {recommendedAction.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{recommendedAction.description}</p>
                      </div>
                      <Button className="rounded-2xl" onClick={recommendedAction.onClick} disabled={recommendedAction.disabled}>
                        {recommendedAction.label}
                      </Button>
                    </div>
                  </section>

                  <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-3xl border bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">上传时间</p>
                      <p className="mt-2 text-sm font-medium">{formatDate(document.created_at)}</p>
                    </div>
                    <div className="rounded-3xl border bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">文件大小</p>
                      <p className="mt-2 text-sm font-medium">{formatBytes(document.file_size)}</p>
                    </div>
                    <div className="rounded-3xl border bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">页数</p>
                      <p className="mt-2 text-sm font-medium">{displayedPageCount || "未知"}</p>
                    </div>
                    <div className="rounded-3xl border bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">语言</p>
                      <p className="mt-2 text-sm font-medium">{document.source_language || "自动识别"} → {document.target_language || "未设置"}</p>
                    </div>
                  </section>

                  <section className="rounded-[28px] border bg-card p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold">阅读入口</h3>
                        <p className="text-sm text-muted-foreground">在进入阅读器之前，先在这里完成高频操作和状态确认。</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {[
                        {
                          title: "继续阅读",
                          description: "沿用上次阅读模式和位置继续工作",
                          icon: BookOpen,
                          onClick: () => openReader(),
                          disabled: false,
                          primary: true,
                        },
                        {
                          title: "查看原文",
                          description: isPdf ? "进入原始 PDF 阅读模式" : "进入解析原文阅读模式",
                          icon: Eye,
                          onClick: () => openReader("original"),
                          disabled: !isPdf && !parseReady,
                        },
                        {
                          title: "查看翻译",
                          description: translatedPdf ? "优先进入翻译版 PDF 阅读模式" : "进入翻译文本阅读模式",
                          icon: Languages,
                          onClick: () => openReader("translated"),
                          disabled: !translationReady && !translatedPdf,
                        },
                        {
                          title: "对照阅读",
                          description: "左右分栏对照原文与翻译",
                          icon: SearchCheck,
                          onClick: () => openReader("compare"),
                          disabled: !compareReady,
                        },
                        {
                          title: "阅读并提问",
                          description: "在阅读器内打开文档问答面板",
                          icon: PanelRightOpen,
                          onClick: () => openReader("ask"),
                          disabled: !askReady,
                        },
                      ].map((action) => {
                        const Icon = action.icon
                        return (
                          <button
                            key={action.title}
                            type="button"
                            onClick={action.onClick}
                            disabled={action.disabled}
                            className={`group rounded-[22px] border p-4 text-left transition-all ${
                              action.primary
                                ? "bg-primary text-primary-foreground shadow-[0_18px_40px_rgba(37,99,235,0.24)]"
                                : "desktop-panel border-border/70 hover:-translate-y-0.5"
                            } ${action.disabled ? "cursor-not-allowed opacity-45" : ""}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`rounded-2xl p-2.5 ${action.primary ? "bg-white/14" : "bg-primary/8 text-primary"}`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium">{action.title}</p>
                                <p className={`mt-1 text-sm ${action.primary ? "text-primary-foreground/82" : "text-muted-foreground"}`}>
                                  {action.description}
                                </p>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),minmax(320px,0.8fr)]">
                    <div className="rounded-[28px] border bg-card p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold">输出与状态</h3>
                          <p className="text-sm text-muted-foreground">所有可用结果都集中在这里确认与导出。</p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between gap-4 rounded-2xl border p-4">
                          <div className="flex items-center gap-3">
                            <FileOutput className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">原文 PDF</p>
                              <p className="text-sm text-muted-foreground">{isPdf && !document.is_file_missing ? "可直接导出原始 PDF" : "当前不是可导出的 PDF 文件"}</p>
                            </div>
                          </div>
                          <Button variant="outline" size="sm" className="rounded-xl" disabled={!isPdf || !!document.is_file_missing} onClick={() => handleExportAsset("original_pdf", document.filename)}>
                            <Download className="mr-1.5 h-4 w-4" />
                            导出
                          </Button>
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-2xl border p-4">
                          <div className="flex items-center gap-3">
                            <Languages className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">翻译版 PDF</p>
                              <p className="text-sm text-muted-foreground">
                                {translatedPdf ? "已接入真实输出资产，可阅读和导出" : "尚未提供翻译版 PDF，可上传替换"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={translatedPdf ? "secondary" : "outline"}>{translatedPdf ? "已准备" : "未提供"}</Badge>
                            <Button variant="outline" size="sm" className="rounded-xl" disabled={!translatedPdf || !!translatedPdf?.is_file_missing} onClick={() => handleExportAsset("translated_pdf", `${document.title}.translated.pdf`)}>
                              <Download className="mr-1.5 h-4 w-4" />
                              导出
                            </Button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-2xl border p-4">
                          <div className="flex items-center gap-3">
                            <FileCode2 className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">Markdown</p>
                              <p className="text-sm text-muted-foreground">
                                {parseReady ? "解析后的 Markdown 已生成" : "完成解析后可导出 Markdown"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={parseReady ? "secondary" : "outline"}>{parseReady ? "已生成" : "未生成"}</Badge>
                            <Button variant="outline" size="sm" className="rounded-xl" disabled={!parseReady} onClick={() => handleExportText("original", "md", "Markdown")}>
                              <Download className="mr-1.5 h-4 w-4" />
                              导出
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-2xl border p-4">
                            <p className="text-sm font-medium">解析结果</p>
                            <div className="mt-3 flex items-center justify-between">
                              {getProgressBadge(document.parse_status, parseJob?.progress)}
                              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => parseMutation.mutate()} disabled={parseMutation.isPending}>
                                <RefreshCcw className="mr-1.5 h-4 w-4" />
                                重试
                              </Button>
                            </div>
                            {parseJob?.error_message ? <p className="mt-2 text-xs text-destructive">{parseJob.error_message}</p> : null}
                          </div>

                          <div className="rounded-2xl border p-4">
                            <p className="text-sm font-medium">翻译结果</p>
                            <div className="mt-3 flex items-center justify-between">
                              {getProgressBadge(document.translation_status, translationJob?.progress)}
                              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => translationMutation.mutate()} disabled={translationMutation.isPending || !parseReady}>
                                <RefreshCcw className="mr-1.5 h-4 w-4" />
                                重试
                              </Button>
                            </div>
                            {translationJob?.error_message ? <p className="mt-2 text-xs text-destructive">{translationJob.error_message}</p> : null}
                          </div>

                          <div className="rounded-2xl border p-4">
                            <p className="text-sm font-medium">索引状态</p>
                            <div className="mt-3 flex items-center justify-between">
                              {getProgressBadge(document.index_status)}
                              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => indexMutation.mutate()} disabled={indexMutation.isPending || !parseReady}>
                                <RefreshCcw className="mr-1.5 h-4 w-4" />
                                重试
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <section className="rounded-[28px] border bg-card p-5">
                        <h3 className="text-lg font-semibold">归档与标注</h3>
                        <div className="mt-4 space-y-4">
                          <div className="space-y-2">
                            <p className="text-sm font-medium">分类</p>
                            <Select
                              value={document.category_id || "none"}
                              onValueChange={(value) => updateDocMutation.mutate({ id: document.id, categoryId: value === "none" ? "" : value })}
                            >
                              <SelectTrigger className="h-9 rounded-xl">
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

                          <div className="space-y-2">
                            <p className="text-sm font-medium">标签</p>
                            <TagPicker documentId={document.id} />
                          </div>
                        </div>
                      </section>

                      <section className="rounded-[28px] border bg-card p-5">
                        <h3 className="text-lg font-semibold">替换与维护</h3>
                        <div className="mt-4 space-y-3">
                          <Button
                            variant="outline"
                            className="h-11 w-full justify-start rounded-2xl"
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
                            className="h-11 w-full justify-start rounded-2xl"
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
                            className="h-11 w-full justify-start rounded-2xl"
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
                      </section>

                      <section className="rounded-[28px] border border-destructive/20 bg-destructive/5 p-5">
                        <h3 className="text-lg font-semibold text-destructive">危险操作</h3>
                        <p className="mt-1 text-sm text-muted-foreground">删除不会直接永久清除，而是先进入回收站，方便你从一级页面集中恢复或清空。</p>
                        <Button variant="destructive" className="mt-4 w-full rounded-2xl" onClick={() => setConfirmTrashOpen(true)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          移入回收站
                        </Button>
                      </section>
                    </div>
                  </section>
                </div>
              </div>
            </section>
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
