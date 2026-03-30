import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { ImportButton } from "@/components/library/ImportButton"
import { TagFilterBar } from "@/components/library/TagFilterBar"
import { TagManagerDialog } from "@/components/library/TagManagerDialog"
import { LibrarySidebar } from "@/components/library/LibrarySidebar"
import { LibraryToolbar } from "@/components/library/LibraryToolbar"
import { LibraryBatchBar } from "@/components/library/LibraryBatchBar"
import { DocumentCard } from "@/components/library/DocumentCard"
import { DocumentList } from "@/components/library/DocumentList"
import { LibraryEmptyState } from "@/components/library/LibraryEmptyState"
import { FolderDialog } from "@/components/library/FolderDialog"
import { DocumentInfoDialog } from "@/components/library/DocumentInfoDialog"
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibrarySelection } from "@/hooks/useLibrarySelection"
import { useLibraryViewState } from "@/hooks/useLibraryViewState"
import { useToast } from "@/hooks/use-toast"
import type { BatchActionReport, Document, Folder, PermanentDeleteReport } from "../../packages/types"
import {
  Archive,
  BookOpen,
  FolderOpen,
  SearchX,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react"

type SortField = "updated" | "created" | "name" | "size"
type ViewMode = "grid" | "list"
type LibraryStatusKey = "all" | "completed" | "pending" | "processing" | "failed" | "deleted"
type ConfirmState =
  | { kind: "trash"; ids: string[]; title: string; description: string }
  | { kind: "permanent"; ids: string[]; title: string; description: string }
  | { kind: "empty-trash"; title: string; description: string }
  | null

const SUPPORTED_EXTENSIONS = ["pdf", "md", "markdown", "txt"]

function deriveLibraryStatus(document: Document): LibraryStatusKey {
  if (document.deleted_at) return "deleted"
  if (document.parse_status === "failed" || document.translation_status === "failed" || document.index_status === "failed") return "failed"
  if (document.parse_status === "parsing" || document.translation_status === "translating" || document.index_status === "indexing") return "processing"
  if (document.parse_status === "completed") return "completed"
  return "pending"
}

function statusLabel(document: Document) {
  switch (deriveLibraryStatus(document)) {
    case "completed":
      return "已完成"
    case "pending":
      return "未处理"
    case "processing":
      return "处理中"
    case "failed":
      return "失败"
    case "deleted":
      return "已删除"
    default:
      return "全部"
  }
}

function formatOutcome(report: BatchActionReport | PermanentDeleteReport) {
  if ("deleted" in report) {
    return { success: report.deleted, failed: report.failed }
  }
  return { success: report.succeeded, failed: report.failed }
}

function getCurrentFolderChildren(folders: Folder[], selectedFolderId: string | null) {
  return folders
    .filter((folder) => (selectedFolderId ? folder.parent_id === selectedFolderId : !folder.parent_id))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export default function Library() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation("library")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { state: persistedView, setState: setPersistedView } = useLibraryViewState()

  const [viewMode, setViewMode] = useState<ViewMode>(persistedView.viewMode)
  const [searchQuery, setSearchQuery] = useState(persistedView.searchQuery)
  const [selectedCategoryKey, setSelectedCategoryKey] = useState(persistedView.selectedCategoryKey)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(persistedView.selectedFolderId)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(persistedView.selectedTagIds)
  const [selectedStatus, setSelectedStatus] = useState<LibraryStatusKey>(persistedView.selectedStatus)
  const [sortField, setSortField] = useState<SortField>(persistedView.sortField)
  const [activeSection, setActiveSection] = useState<"library" | "trash">(persistedView.activeSection)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)

  const selection = useLibrarySelection()
  const handleDropFilesRef = useRef<(paths: string[]) => void>(() => {})
  const lastDropRef = useRef({ signature: "", at: 0 })
  const importingFilesRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setPersistedView({
      viewMode,
      searchQuery,
      selectedCategoryKey,
      selectedFolderId,
      selectedTagIds,
      selectedStatus,
      sortField,
      activeSection,
    })
  }, [activeSection, searchQuery, selectedCategoryKey, selectedFolderId, selectedStatus, selectedTagIds, setPersistedView, sortField, viewMode])

  useEffect(() => {
    const reopenDocumentId = (location.state as { reopenDocumentId?: string } | null)?.reopenDocumentId
    if (!reopenDocumentId) return

    setSelectedDocumentId(reopenDocumentId)
    navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate])

  const invalidateLibraryQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["libraryDocuments"] })
    queryClient.invalidateQueries({ queryKey: ["documents"] })
    queryClient.invalidateQueries({ queryKey: ["parseJobs"] })
    queryClient.invalidateQueries({ queryKey: ["translationJobs"] })
  }, [queryClient])

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["libraryDocuments"],
    queryFn: api.getLibraryDocuments,
    refetchInterval: (query) => {
      const currentDocuments = query.state.data as Document[] | undefined
      return currentDocuments?.some((document) => document.parse_status === "parsing" || document.translation_status === "translating" || document.index_status === "indexing")
        ? 2000
        : false
    },
  })

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.getCategories })
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: api.getFolders })

  const importMutation = useMutation({
    mutationFn: ({ filePath, fileType }: { filePath: string; fileType: string }) => api.importDocument(filePath, fileType),
    onSuccess: () => invalidateLibraryQueries(),
  })

  const createFolderMutation = useMutation({
    mutationFn: api.createFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] })
      toast({ title: "文件夹已创建" })
      setFolderDialogOpen(false)
    },
    onError: (error: Error) => toast({ title: "创建文件夹失败", description: error.message, variant: "destructive" }),
  })

  const batchUpdateMutation = useMutation({
    mutationFn: api.batchUpdateDocuments,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? "批量操作已完成" : "批量操作成功",
        description: `成功 ${outcome.success} 项，失败 ${outcome.failed} 项`,
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: "批量更新失败", description: error.message, variant: "destructive" }),
  })

  const moveToTrashMutation = useMutation({
    mutationFn: api.moveDocumentsToTrash,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      setSelectedDocumentId(null)
      toast({
        title: outcome.failed > 0 ? "部分文档已移入回收站" : "文档已移入回收站",
        description: `成功 ${outcome.success} 项，失败 ${outcome.failed} 项`,
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: "删除失败", description: error.message, variant: "destructive" }),
  })

  const restoreMutation = useMutation({
    mutationFn: api.restoreDocuments,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? "部分文档恢复成功" : "文档已恢复",
        description: `成功 ${outcome.success} 项，失败 ${outcome.failed} 项`,
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: "恢复失败", description: error.message, variant: "destructive" }),
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: api.permanentlyDeleteDocuments,
    onSuccess: (report) => {
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: report.failed > 0 ? "部分文档永久删除失败" : "永久删除完成",
        description: `成功 ${report.deleted} 项，失败 ${report.failed} 项`,
        variant: report.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: "永久删除失败", description: error.message, variant: "destructive" }),
  })

  const emptyTrashMutation = useMutation({
    mutationFn: api.emptyTrash,
    onSuccess: (report) => {
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: report.failed > 0 ? "回收站已部分清空" : "回收站已清空",
        description: `成功 ${report.deleted} 项，失败 ${report.failed} 项`,
        variant: report.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: "清空回收站失败", description: error.message, variant: "destructive" }),
  })

  const handleDropFiles = useCallback(async (paths: string[]) => {
    const normalizedPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)))
    const signature = [...normalizedPaths].map((path) => path.toLowerCase()).sort((left, right) => left.localeCompare(right)).join("||")
    const now = Date.now()
    if (signature && lastDropRef.current.signature === signature && now - lastDropRef.current.at < 1500) return
    lastDropRef.current = { signature, at: now }

    const validFiles = normalizedPaths.filter((path) => SUPPORTED_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() || ""))
    if (validFiles.length === 0) return

    let successCount = 0
    const errors: string[] = []
    for (const file of validFiles) {
      const importKey = file.toLowerCase()
      if (importingFilesRef.current.has(importKey)) continue
      const ext = file.split(".").pop()?.toLowerCase() || ""
      importingFilesRef.current.add(importKey)
      try {
        await importMutation.mutateAsync({ filePath: file, fileType: ext === "markdown" ? "md" : ext })
        successCount += 1
      } catch (error: any) {
        errors.push(error?.message || String(error))
      } finally {
        importingFilesRef.current.delete(importKey)
      }
    }

    if (successCount > 0) toast({ title: t("toast.import_success.title"), description: t("toast.import_success.description") })
    if (errors.length > 0) toast({ title: t("toast.import_error.title"), description: errors[0], variant: "destructive" })
  }, [importMutation, t, toast])

  useEffect(() => {
    handleDropFilesRef.current = handleDropFiles
  }, [handleDropFiles])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    async function setupDragDrop() {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
        const appWindow = getCurrentWebviewWindow()
        const stopListening = await appWindow.onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") setIsDragOver(true)
          else if (event.payload.type === "leave") setIsDragOver(false)
          else if (event.payload.type === "drop") {
            setIsDragOver(false)
            handleDropFilesRef.current(event.payload.paths)
          }
        })
        if (disposed) {
          stopListening()
          return
        }
        unlisten = stopListening
      } catch {}
    }

    setupDragDrop()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const activeDocuments = useMemo(() => documents.filter((document) => !document.deleted_at), [documents])
  const trashDocuments = useMemo(() => documents.filter((document) => !!document.deleted_at), [documents])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const document of activeDocuments) {
      if (document.category_id) counts[document.category_id] = (counts[document.category_id] || 0) + 1
    }
    return counts
  }, [activeDocuments])

  const folderCounts = useMemo(() => {
    const childrenMap = new Map<string, string[]>()
    for (const folder of folders) {
      if (!folder.parent_id) continue
      const current = childrenMap.get(folder.parent_id) || []
      current.push(folder.id)
      childrenMap.set(folder.parent_id, current)
    }
    const directCounts = new Map<string, number>()
    for (const document of activeDocuments) {
      if (!document.folder_id) continue
      directCounts.set(document.folder_id, (directCounts.get(document.folder_id) || 0) + 1)
    }
    const memo = new Map<string, number>()
    const countFolder = (folderId: string): number => {
      const cached = memo.get(folderId)
      if (cached !== undefined) return cached
      const total = (directCounts.get(folderId) || 0) + (childrenMap.get(folderId) || []).reduce((sum, childId) => sum + countFolder(childId), 0)
      memo.set(folderId, total)
      return total
    }
    const counts: Record<string, number> = {}
    for (const folder of folders) counts[folder.id] = countFolder(folder.id)
    return counts
  }, [activeDocuments, folders])

  const uncategorizedCount = useMemo(() => activeDocuments.filter((document) => !document.category_id).length, [activeDocuments])
  const documentsInScope = activeSection === "trash" ? trashDocuments : activeDocuments

  const filteredDocuments = useMemo(() => {
    let result = [...documentsInScope]
    if (activeSection === "library") {
      if (selectedCategoryKey === "uncategorized") result = result.filter((document) => !document.category_id)
      else if (selectedCategoryKey.startsWith("category:")) result = result.filter((document) => document.category_id === selectedCategoryKey.replace("category:", ""))
      if (selectedFolderId) result = result.filter((document) => document.folder_id === selectedFolderId)
    }
    if (selectedTagIds.length > 0) result = result.filter((document) => selectedTagIds.some((tagId) => (document.tags?.map((tag) => tag.id) || []).includes(tagId)))
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase()
      result = result.filter((document) => [document.title, document.filename, document.category_name || "", document.folder_name || "", document.tags?.map((tag) => tag.name).join(" ") || ""].join(" ").toLowerCase().includes(query))
    }
    if (selectedStatus !== "all") result = result.filter((document) => deriveLibraryStatus(document) === selectedStatus)
    result.sort((left, right) => {
      switch (sortField) {
        case "created":
          return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        case "name":
          return left.title.localeCompare(right.title)
        case "size":
          return right.file_size - left.file_size
        default: {
          const leftValue = activeSection === "trash" ? left.deleted_at || left.updated_at : left.updated_at
          const rightValue = activeSection === "trash" ? right.deleted_at || right.updated_at : right.updated_at
          return new Date(rightValue).getTime() - new Date(leftValue).getTime()
        }
      }
    })
    return result
  }, [activeSection, documentsInScope, searchQuery, selectedCategoryKey, selectedFolderId, selectedTagIds, selectedStatus, sortField])

  const visibleFolders = useMemo(() => {
    if (activeSection !== "library") return []
    if (searchQuery.trim() || selectedTagIds.length > 0 || selectedStatus !== "all") return []
    return getCurrentFolderChildren(folders, selectedFolderId)
  }, [activeSection, folders, searchQuery, selectedFolderId, selectedTagIds.length, selectedStatus])

  const currentViewIds = filteredDocuments.map((document) => document.id)
  const selectedFolder = useMemo(() => folders.find((folder) => folder.id === selectedFolderId) || null, [folders, selectedFolderId])

  const handleSectionChange = (section: "library" | "trash") => {
    selection.clearSelection()
    setSelectedDocumentId(null)
    setActiveSection(section)
    if (section === "trash") setSelectedStatus("deleted")
    else if (selectedStatus === "deleted") setSelectedStatus("all")
  }

  const handleCategoryChange = (categoryKey: string) => {
    setSelectedCategoryKey(categoryKey)
    setSelectedFolderId(null)
    handleSectionChange("library")
  }

  const handleFolderChange = (folderId: string | null) => {
    setSelectedFolderId(folderId)
    handleSectionChange("library")
  }

  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId])
  }

  const openDeleteConfirm = (ids: string[]) => setConfirmState({
    kind: "trash",
    ids,
    title: "移入回收站",
    description: ids.length === 1 ? "该文档会从资料库隐藏，并进入回收站。" : `选中的 ${ids.length} 份文档会移入回收站。`,
  })

  const openPermanentDeleteConfirm = (ids: string[]) => setConfirmState({
    kind: "permanent",
    ids,
    title: "永久删除文档",
    description: ids.length === 1 ? "这会删除数据库记录、原始文件和所有已知派生资源，且无法恢复。" : `这会永久删除 ${ids.length} 份文档及其本地文件与派生资源，且无法恢复。`,
  })

  const handleConfirm = () => {
    if (!confirmState) return
    if (confirmState.kind === "trash") moveToTrashMutation.mutate(confirmState.ids)
    else if (confirmState.kind === "permanent") permanentDeleteMutation.mutate(confirmState.ids)
    else emptyTrashMutation.mutate()
    setConfirmState(null)
  }

  const pendingConfirm = moveToTrashMutation.isPending || permanentDeleteMutation.isPending || emptyTrashMutation.isPending

  const sidebar = (
    <LibrarySidebar
      categories={categories}
      folders={folders}
      categoryCounts={categoryCounts}
      folderCounts={folderCounts}
      totalCount={activeDocuments.length}
      uncategorizedCount={uncategorizedCount}
      trashCount={trashDocuments.length}
      activeSection={activeSection}
      selectedCategoryKey={selectedCategoryKey}
      selectedFolderId={selectedFolderId}
      onSelectSection={(section) => {
        setMobileSidebarOpen(false)
        handleSectionChange(section)
      }}
      onSelectCategory={(categoryKey) => {
        setMobileSidebarOpen(false)
        handleCategoryChange(categoryKey)
      }}
      onSelectFolder={(folderId) => {
        setMobileSidebarOpen(false)
        handleFolderChange(folderId)
      }}
      onCreateFolder={() => setFolderDialogOpen(true)}
    />
  )

  return (
    <div className="relative flex h-full overflow-hidden bg-[linear-gradient(180deg,#f7f8fb_0%,#eef1f6_100%)]" data-view-mode={viewMode}>
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
          <div className="rounded-[32px] border-2 border-dashed border-primary bg-card px-10 py-14 text-center shadow-xl">
            <Upload className="mx-auto h-12 w-12 text-primary" />
            <p className="mt-4 text-lg font-semibold">{t("drop.hint")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("drop.hint_detail")}</p>
          </div>
        </div>
      )}

      <div className="hidden h-full w-[280px] shrink-0 xl:block">
        {sidebar}
      </div>

      <Dialog open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <DialogContent className="left-0 top-0 h-full max-w-[320px] translate-x-0 translate-y-0 rounded-none border-r p-0">
          {sidebar}
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b bg-card/70 px-4 py-3 xl:hidden">
          <Button variant="outline" className="gap-2 rounded-2xl" onClick={() => setMobileSidebarOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            分类与文件夹
          </Button>
        </div>

        <LibraryToolbar
          title={activeSection === "trash" ? "回收站" : "文档库"}
          totalLabel={activeSection === "trash" ? `共 ${trashDocuments.length} 份已删除文档` : `共 ${activeDocuments.length} 份文档`}
          searchQuery={searchQuery}
          selectedStatus={selectedStatus}
          sortField={sortField}
          viewMode={viewMode}
          selectionMode={selection.selectionMode}
          onSearchChange={setSearchQuery}
          onStatusChange={setSelectedStatus}
          onSortChange={setSortField}
          onViewModeChange={setViewMode}
          onToggleSelectionMode={() => selection.selectionMode ? selection.clearSelection() : selection.setSelectionMode(true)}
          uploadSlot={<ImportButton />}
        />

        <div className="border-b bg-background/80 px-4 py-3 sm:px-6">
          <TagFilterBar
            selectedTagIds={selectedTagIds}
            onToggleTag={handleToggleTag}
            onClearTags={() => setSelectedTagIds([])}
            onManageTags={() => setTagManagerOpen(true)}
          />
        </div>

        {selection.selectionMode && (
          <LibraryBatchBar
            activeSection={activeSection}
            selectedCount={selection.selectedCount}
            categories={categories}
            folders={folders}
            currentViewIds={currentViewIds}
            onSelectAll={() => selection.selectAll(currentViewIds)}
            onClear={selection.clearSelection}
            onApplyCategory={(categoryId) => batchUpdateMutation.mutate({ documentIds: selection.selectedIds, categoryId })}
            onApplyFolder={(folderId) => batchUpdateMutation.mutate({ documentIds: selection.selectedIds, folderId })}
            onDelete={() => openDeleteConfirm(selection.selectedIds)}
            onRestore={() => restoreMutation.mutate(selection.selectedIds)}
            onPermanentDelete={() => openPermanentDeleteConfirm(selection.selectedIds)}
          />
        )}

        <div className="flex-1 overflow-auto px-4 pb-6 pt-4 sm:px-6">
          {activeSection === "library" && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {selectedCategoryKey !== "all" && (
                <span className="rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground">
                  {selectedCategoryKey === "uncategorized"
                    ? "未分类"
                    : categories.find((category) => `category:${category.id}` === selectedCategoryKey)?.name || "分类"}
                </span>
              )}
              {selectedFolder && (
                <span className="rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground">
                  位于文件夹: {selectedFolder.name}
                </span>
              )}
              {selectedTagIds.length > 0 && (
                <span className="rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground">
                  标签筛选: {selectedTagIds.length}
                </span>
              )}
            </div>
          )}

          {activeSection === "trash" && trashDocuments.length > 0 && (
            <div className="mb-4 flex justify-end">
              <Button
                variant="destructive"
                className="gap-2 rounded-2xl"
                onClick={() => setConfirmState({
                  kind: "empty-trash",
                  title: "清空回收站",
                  description: "这会永久删除回收站中的所有文档，并清理本地文件与已知派生资源。",
                })}
              >
                <Trash2 className="h-4 w-4" />
                清空回收站
              </Button>
            </div>
          )}

          {activeSection === "library" && visibleFolders.length > 0 && (
            <section className="mb-6">
              <div className="mb-3">
                <h2 className="text-lg font-semibold">文件夹</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedFolder ? `当前位于 ${selectedFolder.name}` : "优先浏览根目录文件夹"}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className="flex items-center justify-between rounded-[24px] border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                        <FolderOpen className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium">{folder.name}</p>
                        <p className="text-sm text-muted-foreground">{folderCounts[folder.id] || 0} 份文档</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="space-y-3 rounded-[28px] border bg-card p-4 shadow-sm">
                  <Skeleton className="h-44 rounded-[22px]" />
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredDocuments.length === 0 ? (
            activeSection === "trash" && trashDocuments.length === 0 ? (
              <LibraryEmptyState
                title="回收站为空"
                description="删除后的文档会先进入这里，恢复或永久删除都可以在此完成。"
                icon={<Archive className="h-8 w-8" />}
              />
            ) : searchQuery || selectedTagIds.length > 0 || selectedCategoryKey !== "all" || selectedFolderId || selectedStatus !== "all" ? (
              <LibraryEmptyState
                title="没有匹配结果"
                description="试试调整搜索词、状态、分类、文件夹或标签筛选条件。"
                icon={<SearchX className="h-8 w-8" />}
              />
            ) : activeSection === "library" && selectedFolderId ? (
              <LibraryEmptyState
                title="文件夹还是空的"
                description="可以把文档移动进来，或者在这里继续创建下一级文件夹。"
                actionLabel="新建文件夹"
                onAction={() => setFolderDialogOpen(true)}
                icon={<FolderOpen className="h-8 w-8" />}
              />
            ) : activeSection === "library" ? (
              <LibraryEmptyState
                title="文档库还是空的"
                description="导入第一份文档后，这里会自动生成更适合书库管理的视图。"
                icon={<BookOpen className="h-8 w-8" />}
              />
            ) : (
              <LibraryEmptyState
                title="暂时没有内容"
                description="当前视图下还没有可显示的文档。"
                icon={<SearchX className="h-8 w-8" />}
              />
            )
          ) : viewMode === "grid" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredDocuments.map((document) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  inTrash={activeSection === "trash"}
                  selected={selection.isSelected(document.id)}
                  selectionMode={selection.selectionMode}
                  statusLabel={statusLabel(document)}
                  onOpen={() => setSelectedDocumentId(document.id)}
                  onToggleSelect={(shiftKey) => selection.toggleId(document.id, currentViewIds, shiftKey)}
                  onDelete={() => openDeleteConfirm([document.id])}
                  onRestore={() => restoreMutation.mutate([document.id])}
                  onPermanentDelete={() => openPermanentDeleteConfirm([document.id])}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <DocumentList
                documents={filteredDocuments}
                selectionMode={selection.selectionMode}
                selectedIds={selection.selectedSet}
                statusLabel={statusLabel}
                onOpen={(documentId) => setSelectedDocumentId(documentId)}
                onToggleSelect={(documentId, shiftKey) => selection.toggleId(documentId, currentViewIds, shiftKey)}
                onDelete={(documentId) => openDeleteConfirm([documentId])}
                onRestore={(documentId) => restoreMutation.mutate([documentId])}
                onPermanentDelete={(documentId) => openPermanentDeleteConfirm([documentId])}
                inTrash={activeSection === "trash"}
              />
            </div>
          )}
        </div>
      </div>

      <TagManagerDialog open={tagManagerOpen} onOpenChange={setTagManagerOpen} />
      <FolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        folders={folders}
        defaultParentId={selectedFolderId}
        loading={createFolderMutation.isPending}
        title="新建文件夹"
        confirmLabel="创建"
        cancelLabel="取消"
        onSubmit={(data) => createFolderMutation.mutate(data)}
      />
      <ConfirmActionDialog
        open={!!confirmState}
        onOpenChange={(open) => { if (!open) setConfirmState(null) }}
        title={confirmState?.title || ""}
        description={confirmState?.description || ""}
        confirmLabel={confirmState?.kind === "trash" ? "移入回收站" : confirmState?.kind === "empty-trash" ? "清空回收站" : "永久删除"}
        cancelLabel="取消"
        loading={pendingConfirm}
        onConfirm={handleConfirm}
      />
      <DocumentInfoDialog
        documentId={activeSection === "library" ? selectedDocumentId : null}
        open={!!selectedDocumentId && activeSection === "library"}
        onOpenChange={(open) => { if (!open) setSelectedDocumentId(null) }}
      />
    </div>
  )
}
