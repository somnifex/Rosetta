import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { FileText, FileCode, FileType, Search, Grid, List, Loader2, Upload } from "lucide-react"
import { CategorySidebar } from "@/components/library/CategorySidebar"
import { TagFilterBar } from "@/components/library/TagFilterBar"
import { TagManagerDialog } from "@/components/library/TagManagerDialog"
import { ImportButton } from "@/components/library/ImportButton"
import { DocumentInfoDialog } from "@/components/library/DocumentInfoDialog"
import { useToast } from "@/hooks/use-toast"

type SortField = "date" | "title" | "size" | "status"

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "md":
    case "markdown":
      return FileCode
    case "txt":
      return FileType
    default:
      return FileText
  }
}

export default function Library() {
  const { t } = useTranslation("library")
  const { t: tc } = useTranslation("common")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [sortField, setSortField] = useState<SortField>("date")
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const handleDropFilesRef = useRef<(paths: string[]) => void>(() => {})
  const lastDropRef = useRef<{ signature: string; at: number }>({ signature: "", at: 0 })
  const importingFilesRef = useRef<Set<string>>(new Set())

  const SUPPORTED_EXTENSIONS = ["pdf", "md", "markdown", "txt"]

  const importMutation = useMutation({
    mutationFn: ({ filePath, fileType }: { filePath: string; fileType: string }) =>
      api.importDocument(filePath, fileType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
    },
  })

  const handleDropFiles = useCallback(async (paths: string[]) => {
    const normalizedPaths = Array.from(
      new Set(paths.map((path) => path.trim()).filter(Boolean))
    )
    const signature = [...normalizedPaths]
      .map((path) => path.toLowerCase())
      .sort((a, b) => a.localeCompare(b))
      .join("||")
    const now = Date.now()

    if (
      signature &&
      lastDropRef.current.signature === signature &&
      now - lastDropRef.current.at < 1500
    ) {
      return
    }
    lastDropRef.current = { signature, at: now }

    const validFiles = normalizedPaths.filter((p) => {
      const ext = p.split(".").pop()?.toLowerCase() || ""
      return SUPPORTED_EXTENSIONS.includes(ext)
    })
    if (validFiles.length === 0) return

    let successCount = 0
    const errors: string[] = []
    for (const file of validFiles) {
      const importKey = file.toLowerCase()
      if (importingFilesRef.current.has(importKey)) {
        continue
      }

      const ext = file.split(".").pop()?.toLowerCase() || ""
      const fileType = ext === "markdown" ? "md" : ext
      importingFilesRef.current.add(importKey)
      try {
        await importMutation.mutateAsync({ filePath: file, fileType })
        successCount++
      } catch (err: any) {
        const msg = err?.message || String(err)
        console.error("Import error for", file, msg)
        errors.push(msg)
      } finally {
        importingFilesRef.current.delete(importKey)
      }
    }
    if (successCount > 0) {
      toast({ title: t("toast.import_success.title"), description: t("toast.import_success.description") })
    }
    if (errors.length > 0) {
      toast({ title: t("toast.import_error.title"), description: errors[0], variant: "destructive" })
    }
  }, [importMutation, toast, t])

  useEffect(() => {
    handleDropFilesRef.current = handleDropFiles
  }, [handleDropFiles])

  // Listen for Tauri drag-drop events
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    async function setupDragDrop() {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
        const appWindow = getCurrentWebviewWindow()
        const stopListening = await appWindow.onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragOver(true)
          } else if (event.payload.type === "leave") {
            setIsDragOver(false)
          } else if (event.payload.type === "drop") {
            setIsDragOver(false)
            handleDropFilesRef.current(event.payload.paths)
          }
        })

        if (disposed) {
          stopListening()
          return
        }

        unlisten = stopListening
      } catch {
        // Not in Tauri environment
      }
    }

    setupDragDrop()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: api.getDocuments,
    refetchInterval: (query) => {
      const docs = query.state.data as Array<{
        parse_status: string
        translation_status: string
        index_status: string
      }> | undefined
      return docs?.some(
        (doc) =>
          doc.parse_status === "parsing" ||
          doc.translation_status === "translating" ||
          doc.index_status === "indexing"
      )
        ? 2000
        : false
    },
  })

  // Fetch all document tags for filtering
  const { data: allDocumentTags = {} } = useQuery({
    queryKey: ["allDocumentTags"],
    queryFn: async () => {
      if (!documents || documents.length === 0) return {}
      const tagMap: Record<string, string[]> = {}
      for (const doc of documents) {
        try {
          const tags = await api.getDocumentTags(doc.id)
          tagMap[doc.id] = tags.map((t) => t.id)
        } catch {
          tagMap[doc.id] = []
        }
      }
      return tagMap
    },
    enabled: !!documents && documents.length > 0,
  })

  // Compute category document counts
  const documentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const doc of documents || []) {
      if (doc.category_id) {
        counts[doc.category_id] = (counts[doc.category_id] || 0) + 1
      }
    }
    return counts
  }, [documents])

  // Filter and sort documents
  const filteredDocuments = useMemo(() => {
    let result = documents || []

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (doc) =>
          doc.title.toLowerCase().includes(q) ||
          doc.filename.toLowerCase().includes(q)
      )
    }

    // Category filter
    if (selectedCategoryId) {
      result = result.filter((doc) => doc.category_id === selectedCategoryId)
    }

    // Tag filter
    if (selectedTagIds.length > 0) {
      result = result.filter((doc) => {
        const docTags = allDocumentTags[doc.id] || []
        return selectedTagIds.some((tagId) => docTags.includes(tagId))
      })
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortField) {
        case "title":
          return a.title.localeCompare(b.title)
        case "size":
          return b.file_size - a.file_size
        case "status":
          return a.parse_status.localeCompare(b.parse_status)
        case "date":
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })

    return result
  }, [documents, searchQuery, selectedCategoryId, selectedTagIds, allDocumentTags, sortField])

  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Drag-drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="border-2 border-dashed border-primary rounded-xl p-12 text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-4" />
            <p className="text-lg font-semibold">{t("drop.hint")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("drop.hint_detail")}</p>
          </div>
        </div>
      )}
      {/* Category Sidebar */}
      <CategorySidebar
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
        documentCounts={documentCounts}
        totalDocuments={documents?.length || 0}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="p-6 space-y-4 flex-1 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{t("title")}</h1>
              <p className="text-muted-foreground">{t("subtitle")}</p>
            </div>
            <ImportButton />
          </div>

          {/* Search, Sort, View toggle */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("search.placeholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">{t("sort.date")}</SelectItem>
                <SelectItem value="title">{t("sort.title")}</SelectItem>
                <SelectItem value="size">{t("sort.size")}</SelectItem>
                <SelectItem value="status">{t("sort.status")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("grid")}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Tag filter bar */}
          <TagFilterBar
            selectedTagIds={selectedTagIds}
            onToggleTag={handleToggleTag}
            onClearTags={() => setSelectedTagIds([])}
            onManageTags={() => setTagManagerOpen(true)}
          />

          {/* Document list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredDocuments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {searchQuery || selectedCategoryId || selectedTagIds.length > 0
                    ? t("empty.no_results.title")
                    : t("empty.no_docs.title")}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {searchQuery || selectedCategoryId || selectedTagIds.length > 0
                    ? t("empty.no_results.description")
                    : t("empty.no_docs.description")}
                </p>
              </CardContent>
            </Card>
          ) : viewMode === "grid" ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredDocuments.map((doc) => {
                const Icon = getFileIcon(doc.filename)
                return (
                  <div key={doc.id} onClick={() => setSelectedDocumentId(doc.id)} className="cursor-pointer">
                    <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <Icon className="h-8 w-8 text-primary" />
                          <Badge
                            variant={
                              doc.parse_status === "completed"
                                ? "default"
                                : doc.parse_status === "parsing"
                                  ? "secondary"
                                  : doc.parse_status === "failed"
                                    ? "destructive"
                                    : "outline"
                            }
                          >
                            {doc.parse_status === "parsing" && (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            )}
                            {tc(`status.${doc.parse_status as "pending" | "parsing" | "completed" | "failed"}`)}
                          </Badge>
                        </div>
                        <CardTitle className="text-base mt-2">{doc.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground truncate">{doc.filename}</p>
                        <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                          <span>
                            {doc.page_count} {tc("units.pages")}
                          </span>
                          <span>
                            {(doc.file_size / 1024 / 1024).toFixed(2)} {tc("units.mb")}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {filteredDocuments.map((doc) => {
                    const Icon = getFileIcon(doc.filename)
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setSelectedDocumentId(doc.id)}
                        className="flex items-center justify-between p-4 hover:bg-accent transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-4">
                          <Icon className="h-8 w-8 text-primary" />
                          <div>
                            <p className="font-medium">{doc.title}</p>
                            <p className="text-sm text-muted-foreground">{doc.filename}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-sm text-muted-foreground">
                            <span>
                              {doc.page_count} {tc("units.pages")}
                            </span>
                            <span className="mx-2">&bull;</span>
                            <span>
                              {(doc.file_size / 1024 / 1024).toFixed(2)} {tc("units.mb")}
                            </span>
                          </div>
                          <Badge
                            variant={
                              doc.parse_status === "completed"
                                ? "default"
                                : doc.parse_status === "parsing"
                                  ? "secondary"
                                  : doc.parse_status === "failed"
                                    ? "destructive"
                                    : "outline"
                            }
                          >
                            {doc.parse_status === "parsing" && (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            )}
                            {tc(`status.${doc.parse_status as "pending" | "parsing" | "completed" | "failed"}`)}
                          </Badge>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Tag Manager Dialog */}
      <TagManagerDialog open={tagManagerOpen} onOpenChange={setTagManagerOpen} />

      {/* Document Info Dialog */}
      <DocumentInfoDialog
        documentId={selectedDocumentId}
        open={!!selectedDocumentId}
        onOpenChange={(open) => { if (!open) setSelectedDocumentId(null) }}
      />
    </div>
  )
}
