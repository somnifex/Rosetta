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
import { ExtractFieldsDialog } from "@/components/library/ExtractFieldsDialog"
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
import type {
  BatchActionReport,
  Document,
  DocumentMetadataField,
  Folder,
  PermanentDeleteReport,
} from "../../packages/types"
import {
  Archive,
  BookOpen,
  ChevronRight,
  CornerLeftUp,
  FolderOpen,
  SearchX,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react"
import { getActiveProviderForType } from "@/lib/providers"

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
      return "completed"
    case "pending":
      return "pending"
    case "processing":
      return "processing"
    case "failed":
      return "failed"
    case "deleted":
      return "deleted"
    default:
      return "all"
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

function summarizeDocumentMetadata(fields?: DocumentMetadataField[]) {
  const fieldMap = new Map(fields?.map((field) => [field.field_key, field.field_value || ""]) || [])
  const authors = fieldMap.get("authors") || undefined
  const journal = fieldMap.get("journal") || undefined
  const publicationDate = fieldMap.get("publication_date") || undefined
  return { authors, journal, publicationDate }
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
  const [batchExtractOpen, setBatchExtractOpen] = useState(false)

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
  const { data: tags = [] } = useQuery({ queryKey: ["tags"], queryFn: api.getTags })
  const { data: providers = [] } = useQuery({ queryKey: ["providers"], queryFn: api.getProviders })

  const importMutation = useMutation({
    mutationFn: ({ filePath, fileType }: { filePath: string; fileType: string }) => api.importDocument(filePath, fileType),
    onSuccess: () => invalidateLibraryQueries(),
  })

  const createFolderMutation = useMutation({
    mutationFn: api.createFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] })
      toast({ title: t("toast.folder_created") })
      setFolderDialogOpen(false)
    },
    onError: (error: Error) => toast({ title: t("toast.folder_create_error"), description: error.message, variant: "destructive" }),
  })

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, name, parentId }: { id: string; name: string; parentId: string | null }) => api.updateFolder({ id, name, parentId: parentId ?? undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] })
      invalidateLibraryQueries()
      toast({ title: t("toast.folder_updated") })
    },
    onError: (error: Error) => toast({ title: t("toast.folder_update_error"), description: error.message, variant: "destructive" }),
  })

  const deleteFolderMutation = useMutation({
    mutationFn: api.deleteFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] })
      invalidateLibraryQueries()
      // If we deleted the currently selected folder or a parent of it
      setSelectedFolderId(null)
      toast({ title: t("toast.folder_deleted") })
    },
    onError: (error: Error) => toast({ title: t("toast.folder_delete_error"), description: error.message, variant: "destructive" }),
  })

  const createCategoryMutation = useMutation({
    mutationFn: (name: string) => api.createCategory({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      toast({ title: t("toast.category_created") })
    },
    onError: (error: Error) => toast({ title: t("toast.category_create_error"), description: error.message, variant: "destructive" }),
  })

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateCategory({ id, name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      invalidateLibraryQueries()
      toast({ title: t("toast.category_updated") })
    },
    onError: (error: Error) => toast({ title: t("toast.category_update_error"), description: error.message, variant: "destructive" }),
  })

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      invalidateLibraryQueries()
      toast({ title: t("toast.category_deleted") })
    },
    onError: (error: Error) => toast({ title: t("toast.category_delete_error"), description: error.message, variant: "destructive" }),
  })

  const batchUpdateMutation = useMutation({
    mutationFn: api.batchUpdateDocuments,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? t("batch.update_partial") : t("batch.update_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.update_error"), description: error.message, variant: "destructive" }),
  })

  const moveToTrashMutation = useMutation({
    mutationFn: api.moveDocumentsToTrash,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      setSelectedDocumentId(null)
      toast({
        title: outcome.failed > 0 ? t("batch.trash_partial") : t("batch.trash_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.trash_error"), description: error.message, variant: "destructive" }),
  })

  const restoreMutation = useMutation({
    mutationFn: api.restoreDocuments,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? t("batch.restore_partial") : t("batch.restore_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.restore_error"), description: error.message, variant: "destructive" }),
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: api.permanentlyDeleteDocuments,
    onSuccess: (report) => {
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: report.failed > 0 ? t("batch.permanent_delete_partial") : t("batch.permanent_delete_success"),
        description: t("batch.result_summary", { success: report.deleted, failed: report.failed }),
        variant: report.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.permanent_delete_error"), description: error.message, variant: "destructive" }),
  })

  const emptyTrashMutation = useMutation({
    mutationFn: api.emptyTrash,
    onSuccess: (report) => {
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: report.failed > 0 ? t("batch.empty_trash_partial") : t("batch.empty_trash_success"),
        description: t("batch.result_summary", { success: report.deleted, failed: report.failed }),
        variant: report.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.empty_trash_error"), description: error.message, variant: "destructive" }),
  })

  const batchParseMutation = useMutation({
    mutationFn: api.batchStartParseJobs,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      toast({
        title: outcome.failed > 0 ? t("batch.parse_partial") : t("batch.parse_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.parse_error"), description: error.message, variant: "destructive" }),
  })

  const batchTranslateMutation = useMutation({
    mutationFn: api.batchStartTranslationJobs,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      toast({
        title: outcome.failed > 0 ? t("batch.translate_partial") : t("batch.translate_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.translate_error"), description: error.message, variant: "destructive" }),
  })

  const batchIndexMutation = useMutation({
    mutationFn: api.batchStartIndexJobs,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? t("batch.index_partial") : t("batch.index_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.index_error"), description: error.message, variant: "destructive" }),
  })

  const batchAddTagsMutation = useMutation({
    mutationFn: api.batchAddTags,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      queryClient.invalidateQueries({ queryKey: ["tags"] })
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? t("batch.tag_error") : t("batch.tag_add_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.tag_error"), description: error.message, variant: "destructive" }),
  })

  const batchRemoveTagsMutation = useMutation({
    mutationFn: api.batchRemoveTags,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      queryClient.invalidateQueries({ queryKey: ["tags"] })
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? t("batch.tag_error") : t("batch.tag_remove_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.tag_error"), description: error.message, variant: "destructive" }),
  })

  const batchSetLanguageMutation = useMutation({
    mutationFn: api.batchSetLanguage,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      invalidateLibraryQueries()
      selection.clearSelection()
      toast({
        title: outcome.failed > 0 ? t("batch.language_error") : t("batch.language_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.language_error"), description: error.message, variant: "destructive" }),
  })

  const batchExportMutation = useMutation({
    mutationFn: api.batchExportDocuments,
    onSuccess: (report) => {
      const outcome = formatOutcome(report)
      toast({
        title: outcome.failed > 0 ? t("batch.export_partial") : t("batch.export_success"),
        description: t("batch.result_summary", { success: outcome.success, failed: outcome.failed }),
        variant: outcome.failed > 0 ? "destructive" : "default",
      })
    },
    onError: (error: Error) => toast({ title: t("batch.export_error"), description: error.message, variant: "destructive" }),
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
  const { data: documentMetadataBatch = {} } = useQuery({
    queryKey: ["documentMetadataBatch", activeSection, currentViewIds],
    queryFn: () => api.getAllDocumentsMetadata(currentViewIds),
    enabled: activeSection === "library" && currentViewIds.length > 0,
  })
  const metadataSummaryById = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(documentMetadataBatch).map(([documentId, fields]) => [
          documentId,
          summarizeDocumentMetadata(fields),
        ])
      ),
    [documentMetadataBatch]
  )

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
    title: t("confirm.trash_title"),
    description: ids.length === 1
      ? t("confirm.trash_description_one")
      : t("confirm.trash_description_many", { count: ids.length }),
  })

  const openPermanentDeleteConfirm = (ids: string[]) => setConfirmState({
    kind: "permanent",
    ids,
    title: t("confirm.permanent_title"),
    description: ids.length === 1
      ? t("confirm.permanent_description_one")
      : t("confirm.permanent_description_many", { count: ids.length }),
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
      onUpdateFolder={(id, name) => updateFolderMutation.mutate({ id, name, parentId: folders.find(f => f.id === id)?.parent_id || null })}
      onDeleteFolder={(id) => deleteFolderMutation.mutate(id)}
      onCreateCategory={(name) => createCategoryMutation.mutate(name)}
      onUpdateCategory={(id, name) => updateCategoryMutation.mutate({ id, name })}
      onDeleteCategory={(id) => deleteCategoryMutation.mutate(id)}
    />
  )

  return (
    <div className="app-page-surface relative flex h-full overflow-hidden" data-view-mode={viewMode}>
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
            {t("page.mobile_sidebar")}
          </Button>
        </div>

        <LibraryToolbar
          title={activeSection === "trash" ? t("page.title_trash") : t("page.title_library")}
          totalLabel={
            activeSection === "trash"
              ? t("page.total_trash", { count: trashDocuments.length })
              : t("page.total_library", { count: activeDocuments.length })
          }
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

        <TagFilterBar
          selectedTagIds={selectedTagIds}
          onToggleTag={handleToggleTag}
          onClearTags={() => setSelectedTagIds([])}
          onManageTags={() => setTagManagerOpen(true)}
        />

        {selection.selectionMode && (
          <LibraryBatchBar
            activeSection={activeSection}
            selectedCount={selection.selectedCount}
            categories={categories}
            folders={folders}
            tags={tags}
            currentViewIds={currentViewIds}
            onSelectAll={() => selection.selectAll(currentViewIds)}
            onClear={selection.clearSelection}
            onApplyCategory={(categoryId) => batchUpdateMutation.mutate({ documentIds: selection.selectedIds, categoryId })}
            onApplyFolder={(folderId) => batchUpdateMutation.mutate({ documentIds: selection.selectedIds, folderId })}
            onDelete={() => openDeleteConfirm(selection.selectedIds)}
            onRestore={() => restoreMutation.mutate(selection.selectedIds)}
            onPermanentDelete={() => openPermanentDeleteConfirm(selection.selectedIds)}
            onBatchParse={() => batchParseMutation.mutate(selection.selectedIds)}
            onBatchExtract={() => setBatchExtractOpen(true)}
            onBatchTranslate={() => {
              const provider = getActiveProviderForType(providers, "translate")
              if (!provider) {
                toast({ title: t("batch.no_translate_provider"), variant: "destructive" })
                return
              }
              batchTranslateMutation.mutate({ documentIds: selection.selectedIds, providerId: provider.id })
            }}
            onBatchIndex={() => {
              const provider = getActiveProviderForType(providers, "embed")
              if (!provider) {
                toast({ title: t("batch.no_embed_provider"), variant: "destructive" })
                return
              }
              batchIndexMutation.mutate({ documentIds: selection.selectedIds, providerId: provider.id })
            }}
            onBatchAddTags={(tagIds) => batchAddTagsMutation.mutate({ documentIds: selection.selectedIds, tagIds })}
            onBatchRemoveTags={(tagIds) => batchRemoveTagsMutation.mutate({ documentIds: selection.selectedIds, tagIds })}
            onBatchSetLanguage={(source, target) => batchSetLanguageMutation.mutate({ documentIds: selection.selectedIds, sourceLanguage: source, targetLanguage: target })}
            onBatchExport={(format, contentType, outputDir) => batchExportMutation.mutate({ documentIds: selection.selectedIds, format, contentType, outputDir })}
            isParsePending={batchParseMutation.isPending}
            isTranslatePending={batchTranslateMutation.isPending}
          />
        )}

        <div className="flex-1 overflow-auto px-4 pb-6 pt-4 sm:px-6">
          {activeSection === "library" && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {selectedCategoryKey !== "all" && (
                <span className="rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground">
                  {selectedCategoryKey === "uncategorized"
                    ? t("fields.uncategorized")
                    : categories.find((category) => `category:${category.id}` === selectedCategoryKey)?.name || t("page.filter_category_default")}
                </span>
              )}
              {selectedTagIds.length > 0 && (
                <span className="rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground">
                  {t("page.selected_tag_filter", { count: selectedTagIds.length })}
                </span>
              )}
            </div>
          )}

          {/* Folder breadcrumb with back navigation */}
          {activeSection === "library" && selectedFolderId && (() => {
            const buildBreadcrumb = () => {
              const crumbs: { id: string | null; name: string }[] = [{ id: null, name: t("breadcrumb.root") }]
              const visited = new Set<string>()
              let currentId: string | null = selectedFolderId
              const path: { id: string; name: string }[] = []
              while (currentId) {
                if (visited.has(currentId)) break
                visited.add(currentId)
                const f = folders.find((folder) => folder.id === currentId)
                if (!f) break
                path.unshift({ id: f.id, name: f.name })
                currentId = f.parent_id || null
              }
              return [...crumbs, ...path]
            }
            const breadcrumb = buildBreadcrumb()
            const parentId = selectedFolder?.parent_id || null
            return (
              <div className="mb-4 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-lg shadow-none text-muted-foreground h-8"
                  onClick={() => setSelectedFolderId(parentId)}
                >
                  <CornerLeftUp className="h-3.5 w-3.5" />
                  {t("breadcrumb.back_to_parent")}
                </Button>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  {breadcrumb.map((crumb, index) => {
                    const isLast = index === breadcrumb.length - 1
                    return (
                      <span key={crumb.id ?? "root"} className="flex items-center gap-1">
                        {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                        {isLast ? (
                          <span className="font-medium text-foreground">{crumb.name}</span>
                        ) : (
                          <button
                            type="button"
                            className="hover:text-foreground transition-colors hover:underline"
                            onClick={() => setSelectedFolderId(crumb.id)}
                          >
                            {crumb.name}
                          </button>
                        )}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {activeSection === "trash" && trashDocuments.length > 0 && (
            <div className="mb-4 flex justify-end">
              <Button
                variant="destructive"
                className="gap-2 rounded-2xl"
                onClick={() => setConfirmState({
                  kind: "empty-trash",
                  title: t("confirm.empty_trash_title"),
                  description: t("confirm.empty_trash_description"),
                })}
              >
                <Trash2 className="h-4 w-4" />
                {t("page.empty_trash_action")}
              </Button>
            </div>
          )}

          {activeSection === "library" && visibleFolders.length > 0 && (
            <section className="mb-6">
              <div className="mb-3">
                <h2 className="text-lg font-semibold">{t("folders.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedFolder ? t("folders.current_location", { name: selectedFolder.name }) : t("folders.root_hint")}
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
                        <p className="text-sm text-muted-foreground">{t("folders.count", { count: folderCounts[folder.id] || 0 })}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {isLoading ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 220px))' }}>
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-lg border bg-card">
                  <Skeleton className="aspect-[3/4]" />
                  <div className="px-3 py-2.5 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredDocuments.length === 0 ? (
            activeSection === "trash" && trashDocuments.length === 0 ? (
              <LibraryEmptyState
                title={t("empty.trash.title")}
                description={t("empty.trash.description")}
                icon={<Archive className="h-8 w-8" />}
              />
            ) : searchQuery || selectedTagIds.length > 0 || selectedCategoryKey !== "all" || selectedFolderId || selectedStatus !== "all" ? (
              <LibraryEmptyState
                title={t("empty.no_results.title")}
                description={t("empty.no_results.description")}
                icon={<SearchX className="h-8 w-8" />}
              />
            ) : activeSection === "library" && selectedFolderId ? (
              <LibraryEmptyState
                title={t("empty.folder.title")}
                description={t("empty.folder.description")}
                actionLabel={t("empty.folder.action")}
                onAction={() => setFolderDialogOpen(true)}
                icon={<FolderOpen className="h-8 w-8" />}
              />
            ) : activeSection === "library" ? (
              <LibraryEmptyState
                title={t("empty.library.title")}
                description={t("empty.library.description")}
                icon={<BookOpen className="h-8 w-8" />}
              />
            ) : (
              <LibraryEmptyState
                title={t("empty.generic.title")}
                description={t("empty.generic.description")}
                icon={<SearchX className="h-8 w-8" />}
              />
            )
          ) : viewMode === "grid" ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 220px))' }}>
              {filteredDocuments.map((document) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  inTrash={activeSection === "trash"}
                  selected={selection.isSelected(document.id)}
                  selectionMode={selection.selectionMode}
                  statusLabel={t(`statuses.${statusLabel(document)}` as any)}
                  metadataSummary={metadataSummaryById[document.id]}
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
              <div className="min-w-[800px]">
              <DocumentList
                documents={filteredDocuments}
                selectionMode={selection.selectionMode}
                selectedIds={selection.selectedSet}
                statusLabel={(document) => t(`statuses.${statusLabel(document)}` as any)}
                metadataSummaryById={metadataSummaryById}
                onOpen={(documentId) => setSelectedDocumentId(documentId)}
                onToggleSelect={(documentId, shiftKey) => selection.toggleId(documentId, currentViewIds, shiftKey)}
                onDelete={(documentId) => openDeleteConfirm([documentId])}
                onRestore={(documentId) => restoreMutation.mutate([documentId])}
                onPermanentDelete={(documentId) => openPermanentDeleteConfirm([documentId])}
                inTrash={activeSection === "trash"}
              />
              </div>
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
        title={t("folders.new")}
        confirmLabel={t("btn.create")}
        cancelLabel={t("btn.cancel")}
        onSubmit={(data) => createFolderMutation.mutate(data)}
      />
      <ConfirmActionDialog
        open={!!confirmState}
        onOpenChange={(open) => { if (!open) setConfirmState(null) }}
        title={confirmState?.title || ""}
        description={confirmState?.description || ""}
        confirmLabel={
          confirmState?.kind === "trash"
            ? t("confirm.confirm_move_to_trash")
            : confirmState?.kind === "empty-trash"
            ? t("confirm.confirm_empty_trash")
            : t("confirm.confirm_permanent_delete")
        }
        cancelLabel={t("btn.cancel")}
        loading={pendingConfirm}
        onConfirm={handleConfirm}
      />
      <DocumentInfoDialog
        documentId={activeSection === "library" ? selectedDocumentId : null}
        open={!!selectedDocumentId && activeSection === "library"}
        onOpenChange={(open) => { if (!open) setSelectedDocumentId(null) }}
      />
      <ExtractFieldsDialog
        open={batchExtractOpen}
        documentIds={selection.selectedIds}
        onOpenChange={setBatchExtractOpen}
        onCompleted={() => {
          queryClient.invalidateQueries({ queryKey: ["documentMetadataBatch"] })
          queryClient.invalidateQueries({ queryKey: ["documentMetadata"] })
        }}
      />
    </div>
  )
}
