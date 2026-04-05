import { useState } from "react"
import { useTranslation } from "react-i18next"
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
  metadataSummaryById?: Record<
    string,
    {
      authors?: string
      publicationDate?: string
      journal?: string
    }
  >
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
  metadataSummaryById = {},
  onOpen,
  onToggleSelect,
  onDelete,
  onRestore,
  onPermanentDelete,
  inTrash,
}: DocumentListProps) {
  const ctx = useDocumentContextMenu()
  const { t } = useTranslation("library")
  const [renameDoc, setRenameDoc] = useState<Document | null>(null)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className={cn("grid gap-3 border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground", COL_TEMPLATE)}>
        <span />
        <span>{t("table.document")}</span>
        <span>{t("table.category_folder")}</span>
        <span className="text-center">{t("table.status")}</span>
        <span className="text-right">{t("table.size")}</span>
        <span>{inTrash ? t("table.deleted_at") : t("table.updated_at")}</span>
        <span className="text-center">{t("table.actions")}</span>
      </div>

      <div className="divide-y divide-border">
        {documents.map((document) => {
          const Icon = getFileIcon(document.filename)
          const isSelected = selectedIds.has(document.id)
          const metadataSummary = metadataSummaryById[document.id]
          const metadataText = metadataSummary?.authors || metadataSummary?.journal || ""
          const publicationYear = metadataSummary?.publicationDate?.slice(0, 4) || ""
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
              <button
                type="button"
                className="h-5 w-5 shrink-0 rounded border border-border bg-background flex items-center justify-center"
                onClick={(event) => onToggleSelect(document.id, event.shiftKey)}
              >
                {isSelected && <div className="h-3 w-3 rounded-sm bg-primary" />}
              </button>

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
                  {(metadataText || publicationYear) && (
                    <p className="truncate text-[11px] text-muted-foreground/90">
                      {[metadataText, publicationYear].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <p className="truncate text-sm">{document.category_name || t("fields.uncategorized")}</p>
                <p className="truncate text-xs text-muted-foreground">{document.folder_name || t("fields.root_folder")}</p>
              </div>

              <div className="flex justify-center">
                <Badge variant="outline" className="rounded-full shadow-none font-normal text-[11px] px-2 py-0">
                  {statusLabel(document)}
                </Badge>
              </div>

              <div className="text-right text-sm text-muted-foreground">
                {formatBytes(document.file_size)}
              </div>

              <div className="text-sm text-muted-foreground">
                {formatDate(inTrash ? document.deleted_at : document.updated_at)}
              </div>

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
                    <ContextMenuItem onClick={() => onOpen(document.id)}>{t("context_menu.open")}</ContextMenuItem>
                    <ContextMenuItem onClick={() => ctx.revealMutation.mutate(document.id)}>{t("context_menu.reveal")}</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => setRenameDoc(document)}>{t("context_menu.rename")}</ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>{t("context_menu.copy")}</ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuItem onClick={() => ctx.handleCopy(document.title, t("copy_labels.document_name"))}>{t("context_menu.copy_name")}</ContextMenuItem>
                        <ContextMenuItem onClick={() => ctx.handleCopy(document.id, t("copy_labels.document_id"))}>{t("context_menu.copy_id")}</ContextMenuItem>
                        <ContextMenuItem onClick={() => ctx.handleCopyPath(document.id)}>{t("context_menu.copy_path")}</ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onClick={() => ctx.duplicateMutation.mutate(document.id)}>{t("context_menu.duplicate")}</ContextMenuItem>
                    <ContextMenuSeparator />
                    {ctx.categories.length > 0 && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>{t("context_menu.move_to_category")}</ContextMenuSubTrigger>
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
                        <ContextMenuSubTrigger>{t("context_menu.move_to_folder")}</ContextMenuSubTrigger>
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
                    <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(document.id)}>{t("context_menu.move_to_trash")}</ContextMenuItem>
                  </>
                ) : (
                  <>
                    <ContextMenuItem onClick={() => onRestore(document.id)}>{t("context_menu.restore")}</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onPermanentDelete(document.id)}>{t("context_menu.permanent_delete")}</ContextMenuItem>
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
