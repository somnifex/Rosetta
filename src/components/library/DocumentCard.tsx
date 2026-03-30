import { useMemo, useState } from "react"
import { Document as PdfDocument, Page, pdfjs } from "react-pdf"
import { convertFileSrc } from "@tauri-apps/api/core"
import type { Document } from "../../../packages/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Eye,
  FileCode,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "md":
    case "markdown":
      return FileCode
    default:
      return FileText
  }
}

function formatBytes(size: number) {
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(value?: string) {
  if (!value) return "-"
  return new Date(value).toLocaleDateString()
}

function PdfThumbnail({ filePath }: { filePath: string }) {
  const [loading, setLoading] = useState(true)
  const fileUrl = useMemo(() => convertFileSrc(filePath), [filePath])

  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#fff_0%,#eef1f7_55%,#dbe2f0_100%)]">
      {loading && <Loader2 className="absolute h-5 w-5 animate-spin text-muted-foreground" />}
      <PdfDocument file={fileUrl} loading={null} onLoadSuccess={() => setLoading(false)} onLoadError={() => setLoading(false)}>
        <Page
          pageNumber={1}
          width={132}
          renderAnnotationLayer={false}
          renderTextLayer={false}
        />
      </PdfDocument>
    </div>
  )
}

interface DocumentCardProps {
  document: Document
  inTrash: boolean
  selected: boolean
  selectionMode: boolean
  statusLabel: string
  onOpen: () => void
  onToggleSelect: (shiftKey: boolean) => void
  onDelete: () => void
  onRestore: () => void
  onPermanentDelete: () => void
}

export function DocumentCard({
  document,
  inTrash,
  selected,
  selectionMode,
  statusLabel,
  onOpen,
  onToggleSelect,
  onDelete,
  onRestore,
  onPermanentDelete,
}: DocumentCardProps) {
  const Icon = getFileIcon(document.filename)
  const isPdf = document.filename.toLowerCase().endsWith(".pdf")

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[28px] border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl",
        selected && "border-primary shadow-lg ring-2 ring-primary/30"
      )}
    >
      <button
        type="button"
        className="absolute left-3 top-3 z-10 h-5 w-5 rounded border border-border bg-background/90"
        onClick={(event) => {
          event.stopPropagation()
          onToggleSelect(event.shiftKey)
        }}
      >
        {selected && <div className="mx-auto mt-0.5 h-3 w-3 rounded-sm bg-primary" />}
      </button>

      <div
        className="cursor-pointer"
        onClick={(event) => {
          if (selectionMode) {
            onToggleSelect(event.shiftKey)
            return
          }
          onOpen()
        }}
      >
        <div className="relative h-48 overflow-hidden border-b bg-muted/40">
          {isPdf && !document.is_file_missing ? (
            <PdfThumbnail filePath={document.file_path} />
          ) : (
            <div className="flex h-full items-center justify-center bg-[linear-gradient(160deg,#f5f7fb_0%,#eef2f8_45%,#dde5f2_100%)]">
              <Icon className="h-16 w-16 text-muted-foreground/80" />
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex translate-y-3 items-center justify-end gap-2 px-3 pb-3 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
            {!inTrash ? (
              <>
                <Button size="icon" variant="secondary" className="h-9 w-9 rounded-full shadow-lg" onClick={(event) => { event.stopPropagation(); onOpen() }}>
                  <Eye className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="destructive" className="h-9 w-9 rounded-full shadow-lg" onClick={(event) => { event.stopPropagation(); onDelete() }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button size="icon" variant="secondary" className="h-9 w-9 rounded-full shadow-lg" onClick={(event) => { event.stopPropagation(); onRestore() }}>
                  <ArchiveRestore className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="destructive" className="h-9 w-9 rounded-full shadow-lg" onClick={(event) => { event.stopPropagation(); onPermanentDelete() }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="line-clamp-2 text-base font-semibold leading-6">{document.title}</h3>
                <p className="mt-1 truncate text-sm text-muted-foreground">{document.filename}</p>
              </div>
              {document.is_file_missing && (
                <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-500" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{statusLabel}</Badge>
              {document.category_name && <Badge variant="secondary">{document.category_name}</Badge>}
              {document.folder_name && <Badge variant="secondary">{document.folder_name}</Badge>}
              {document.is_file_missing && <Badge variant="destructive">本地文件缺失</Badge>}
              {document.translation_status === "completed" && (
                <Badge className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  已翻译
                </Badge>
              )}
            </div>
          </div>

          {document.tags && document.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {document.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag.name}
                </span>
              ))}
              {document.tags.length > 3 && (
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  +{document.tags.length - 3}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatDate(inTrash ? document.deleted_at : document.updated_at)}</span>
            <span>{formatBytes(document.file_size)}</span>
          </div>
        </div>
      </div>
    </article>
  )
}
