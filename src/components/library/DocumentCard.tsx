import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Document as PdfDocument, Page, pdfjs } from "react-pdf"
import { convertFileSrc } from "@tauri-apps/api/core"
import type { Document } from "../../../packages/types"
import { Badge } from "@/components/ui/badge"
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
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(value?: string) {
  if (!value) return "-"
  return new Date(value).toLocaleDateString()
}

function PdfThumbnail({ filePath }: { filePath: string }) {
  const [loading, setLoading] = useState(true)
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileUrl = useMemo(() => convertFileSrc(filePath), [filePath])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    setContainerWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="pdf-preview-stage h-full w-full overflow-hidden">
      {loading && <Loader2 className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground/50" />}
      {containerWidth > 0 && (
        <PdfDocument file={fileUrl} loading={null} onLoadSuccess={() => setLoading(false)} onLoadError={() => setLoading(false)}>
          <Page
            pageNumber={1}
            width={containerWidth}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </PdfDocument>
      )}
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
  const ctx = useDocumentContextMenu()
  const { t } = useTranslation("library")
  const [renameOpen, setRenameOpen] = useState(false)

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>
      <article
        className={cn(
          "group relative overflow-hidden rounded-lg bg-background border border-border transition-all hover:shadow-md hover:border-border/90",
          selected && "border-primary shadow-sm ring-1 ring-primary"
        )}
      >
      {/* Selection checkbox */}
      <button
        type="button"
        className="absolute left-2.5 top-2.5 z-10 h-5 w-5 rounded border border-border bg-background/90 flex items-center justify-center"
        onClick={(event) => {
          event.stopPropagation()
          onToggleSelect(event.shiftKey)
        }}
      >
        {selected && <div className="h-3 w-3 rounded-sm bg-primary" />}
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
        {/* A4 Preview — portrait ratio */}
        <div className="relative aspect-[3/4] overflow-hidden border-b border-border bg-muted/45">
          {isPdf && !document.is_file_missing ? (
            <PdfThumbnail filePath={document.file_path} />
          ) : (
            <div className="flex h-full items-center justify-center bg-muted/45">
              <Icon className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}

          {/* Hover action overlay - bottom strip */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1.5 px-2.5 pb-2 pt-6 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
            {!inTrash ? (
              <>
                <button
                  type="button"
                  className="rounded-full bg-background/90 p-1.5 text-foreground shadow-sm backdrop-blur-sm hover:bg-background transition-colors"
                  onClick={(event) => { event.stopPropagation(); onOpen() }}
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-full bg-background/90 p-1.5 text-destructive shadow-sm backdrop-blur-sm hover:bg-background transition-colors"
                  onClick={(event) => { event.stopPropagation(); onDelete() }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-full bg-background/90 p-1.5 text-foreground shadow-sm backdrop-blur-sm hover:bg-background transition-colors"
                  onClick={(event) => { event.stopPropagation(); onRestore() }}
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-full bg-background/90 p-1.5 text-destructive shadow-sm backdrop-blur-sm hover:bg-background transition-colors"
                  onClick={(event) => { event.stopPropagation(); onPermanentDelete() }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Info section — compact 2-line layout */}
        <div className="px-3 py-2.5 space-y-1.5">
          {/* Row 1: Title + status */}
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="truncate text-sm font-medium leading-5 flex-1">{document.title}</h3>
            {document.is_file_missing && (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
            <Badge
              variant="outline"
              className="shrink-0 rounded-full shadow-none font-normal text-[11px] px-2 py-0"
            >
              {statusLabel}
            </Badge>
            {document.translation_status === "completed" && (
              <Badge className="shrink-0 gap-0.5 rounded-full shadow-none font-normal text-[11px] px-2 py-0 bg-primary text-primary-foreground">
                <CheckCircle2 className="h-2.5 w-2.5" />
                {t("badge.translated")}
              </Badge>
            )}
          </div>

          {/* Row 2: filename + date + size */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate flex-1">{document.filename}</span>
            <span className="shrink-0">{formatDate(inTrash ? document.deleted_at : document.updated_at)}</span>
            <span className="shrink-0">{formatBytes(document.file_size)}</span>
          </div>
        </div>
      </div>
    </article>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {!inTrash ? (
          <>
            <ContextMenuItem onClick={onOpen}>{t("context_menu.open")}</ContextMenuItem>
            <ContextMenuItem onClick={() => ctx.revealMutation.mutate(document.id)}>{t("context_menu.reveal")}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setRenameOpen(true)}>{t("context_menu.rename")}</ContextMenuItem>
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
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>{t("context_menu.move_to_trash")}</ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={onRestore}>{t("context_menu.restore")}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={onPermanentDelete}>{t("context_menu.permanent_delete")}</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
    <RenameDialog
      open={renameOpen}
      document={renameOpen ? document : null}
      onOpenChange={setRenameOpen}
      onConfirm={(id, title) => ctx.renameMutation.mutate({ id, title })}
    />
    </>
  )
}
