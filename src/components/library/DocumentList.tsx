import type { Document } from "../../../packages/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  ArchiveRestore,
  Eye,
  FileCode,
  FileText,
  Trash2,
} from "lucide-react"

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

interface DocumentListProps {
  documents: Document[]
  selectionMode: boolean
  selectedIds: Set<string>
  statusLabel: (document: Document) => string
  onOpen: (documentId: string) => void
  onToggleSelect: (documentId: string, shiftKey: boolean) => void
  onDelete: (documentId: string) => void
  onRestore: (documentId: string) => void
  onPermanentDelete: (documentId: string) => void
  inTrash: boolean
}

export function DocumentList({
  documents,
  selectionMode,
  selectedIds,
  statusLabel,
  onOpen,
  onToggleSelect,
  onDelete,
  onRestore,
  onPermanentDelete,
  inTrash,
}: DocumentListProps) {
  return (
    <div className="overflow-hidden rounded-[28px] border bg-card shadow-sm">
      <div className="grid grid-cols-[44px,minmax(0,2fr),minmax(0,1fr),120px,110px,140px] gap-3 border-b px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span />
        <span>文档</span>
        <span>分类 / 文件夹</span>
        <span>状态</span>
        <span>大小</span>
        <span>{inTrash ? "删除时间" : "更新时间"}</span>
      </div>
      <div className="divide-y">
        {documents.map((document) => {
          const Icon = getFileIcon(document.filename)
          return (
            <div
              key={document.id}
              className={cn(
                "grid grid-cols-[44px,minmax(0,2fr),minmax(0,1fr),120px,110px,140px] gap-3 px-4 py-4 transition-colors hover:bg-accent/40",
                selectedIds.has(document.id) && "bg-primary/5"
              )}
            >
              <button
                type="button"
                className="mt-1 h-5 w-5 rounded border border-border bg-background"
                onClick={(event) => onToggleSelect(document.id, event.shiftKey)}
              >
                {selectedIds.has(document.id) && <div className="mx-auto mt-0.5 h-3 w-3 rounded-sm bg-primary" />}
              </button>

              <div
                className="flex min-w-0 cursor-pointer items-start gap-3"
                onClick={(event) => {
                  if (selectionMode) {
                    onToggleSelect(document.id, event.shiftKey)
                    return
                  }
                  onOpen(document.id)
                }}
              >
                <div className="rounded-2xl bg-muted p-3">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{document.title}</p>
                    {document.is_file_missing && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{document.filename}</p>
                  {document.tags && document.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {document.tags.slice(0, 3).map((tag) => (
                        <span key={tag.id} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <p className="truncate text-sm">{document.category_name || "未分类"}</p>
                <p className="truncate text-sm text-muted-foreground">{document.folder_name || "根目录"}</p>
              </div>

              <div className="flex flex-col gap-2">
                <Badge variant="outline" className="justify-center">
                  {statusLabel(document)}
                </Badge>
                {document.is_file_missing && (
                  <Badge variant="destructive" className="justify-center">
                    缺失
                  </Badge>
                )}
              </div>

              <div className="text-sm text-muted-foreground">{formatBytes(document.file_size)}</div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {formatDate(inTrash ? document.deleted_at : document.updated_at)}
                </span>
                <div className="flex items-center gap-1">
                  {!inTrash ? (
                    <>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onOpen(document.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(document.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onRestore(document.id)}>
                        <ArchiveRestore className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onPermanentDelete(document.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
