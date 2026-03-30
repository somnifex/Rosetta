import { useState } from "react"
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import { useDocumentContextMenu } from "@/hooks/useDocumentContextMenu"
import { RenameDialog } from "./RenameDialog"

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
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
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

const COL_TEMPLATE = "grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_100px_90px_120px_80px]"

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
  const ctx = useDocumentContextMenu()
  const [renameDoc, setRenameDoc] = useState<Document | null>(null)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      {/* Table header */}
      <div className={cn("grid gap-3 border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground", COL_TEMPLATE)}>
        <span />
        <span>文档</span>
        <span>分类 / 文件夹</span>
        <span className="text-center">状态</span>
        <span className="text-right">大小</span>
        <span>{inTrash ? "删除时间" : "更新时间"}</span>
        <span className="text-center">操作</span>
      </div>

      {/* Table rows */}
      <div className="divide-y divide-border">
        {documents.map((document) => {
          const Icon = getFileIcon(document.filename)
          const isSelected = selectedIds.has(document.id)
          return (
            <ContextMenu key={document.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    "grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40",
                    COL_TEMPLATE,
                    isSelected && "bg-primary/5"
                  )}
                >
              {/* Checkbox */}
              <button
                type="button"
                className="h-5 w-5 shrink-0 rounded border border-border bg-background flex items-center justify-center"
                onClick={(event) => onToggleSelect(document.id, event.shiftKey)}
              >
                {isSelected && <div className="h-3 w-3 rounded-sm bg-primary" />}
              </button>

              {/* Document info */}
              <div
                className="flex min-w-0 cursor-pointer items-center gap-2.5"
                onClick={(event) => {
                  if (selectionMode) {
                    onToggleSelect(document.id, event.shiftKey)
                    return
                  }
                  onOpen(document.id)
                }}
              >
                <div className="shrink-0 rounded-lg bg-muted p-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{document.title}</p>
                    {document.is_file_missing && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{document.filename}</p>
                </div>
              </div>

              {/* Category / Folder */}
              <div className="min-w-0">
                <p className="truncate text-sm">{document.category_name || "未分类"}</p>
                <p className="truncate text-xs text-muted-foreground">{document.folder_name || "根目录"}</p>
              </div>

              {/* Status */}
              <div className="flex justify-center">
                <Badge variant="outline" className="rounded-full shadow-none font-normal text-[11px] px-2 py-0">
                  {statusLabel(document)}
                </Badge>
              </div>

              {/* Size */}
              <div className="text-right text-sm text-muted-foreground">
                {formatBytes(document.file_size)}
              </div>

              {/* Date */}
              <div className="text-sm text-muted-foreground">
                {formatDate(inTrash ? document.deleted_at : document.updated_at)}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-center gap-0.5">
                {!inTrash ? (
                  <>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onOpen(document.id)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(document.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onRestore(document.id)}>
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onPermanentDelete(document.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-56">
                {!inTrash ? (
                  <>
                    <ContextMenuItem onClick={() => onOpen(document.id)}>打开</ContextMenuItem>
                    <ContextMenuItem onClick={() => ctx.revealMutation.mutate(document.id)}>在文件夹中显示</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => setRenameDoc(document)}>重命名</ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>复制</ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuItem onClick={() => ctx.handleCopy(document.title, "文档名称")}>复制文档名称</ContextMenuItem>
                        <ContextMenuItem onClick={() => ctx.handleCopy(document.id, "文档 ID")}>复制文档 ID</ContextMenuItem>
                        <ContextMenuItem onClick={() => ctx.handleCopyPath(document.id)}>复制物理路径</ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onClick={() => ctx.duplicateMutation.mutate(document.id)}>创建副本</ContextMenuItem>
                    <ContextMenuSeparator />
                    {ctx.categories.length > 0 && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>移动到分类</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {ctx.categories.map((c) => (
                            <ContextMenuItem key={c.id} onClick={() => ctx.moveMutation.mutate({ documentId: document.id, categoryId: c.id })}>
                              {c.name}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    {ctx.folders.length > 0 && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>移动到文件夹</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          {ctx.folders.map((f) => (
                            <ContextMenuItem key={f.id} onClick={() => ctx.moveMutation.mutate({ documentId: document.id, folderId: f.id })}>
                              {f.name}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(document.id)}>移入回收站</ContextMenuItem>
                  </>
                ) : (
                  <>
                    <ContextMenuItem onClick={() => onRestore(document.id)}>恢复文档</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onPermanentDelete(document.id)}>永久删除</ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <RenameDialog
        open={!!renameDoc}
        document={renameDoc}
        onOpenChange={(o) => (!o ? setRenameDoc(null) : undefined)}
        onConfirm={(id, title) => ctx.renameMutation.mutate({ id, title })}
      />
    </div>
  )
}
