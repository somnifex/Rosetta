import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FolderOpen, Folder, Plus, Pencil, Trash2, Check, X, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Category } from "../../../packages/types"

interface CategorySidebarProps {
  selectedCategoryId: string | null
  onSelectCategory: (id: string | null) => void
  documentCounts: Record<string, number>
  totalDocuments: number
}

export function CategorySidebar({
  selectedCategoryId,
  onSelectCategory,
  documentCounts,
  totalDocuments,
}: CategorySidebarProps) {
  const { t } = useTranslation("library")
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.getCategories,
  })

  const createMutation = useMutation({
    mutationFn: api.createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      setIsCreating(false)
      setNewName("")
    },
  })

  const updateMutation = useMutation({
    mutationFn: api.updateCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      setEditingId(null)
      setEditName("")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      if (selectedCategoryId === editingId) {
        onSelectCategory(null)
      }
    },
  })

  const tree = useMemo(() => {
    const roots: Category[] = []
    const childrenMap = new Map<string, Category[]>()

    for (const cat of categories) {
      if (cat.parent_id) {
        const children = childrenMap.get(cat.parent_id) || []
        children.push(cat)
        childrenMap.set(cat.parent_id, children)
      } else {
        roots.push(cat)
      }
    }

    return { roots, childrenMap }
  }, [categories])

  const handleCreate = () => {
    if (newName.trim()) {
      createMutation.mutate({ name: newName.trim() })
    }
  }

  const handleUpdate = (id: string) => {
    if (editName.trim()) {
      updateMutation.mutate({ id, name: editName.trim() })
    }
  }

  const renderCategory = (cat: Category, depth: number = 0) => {
    const children = tree.childrenMap.get(cat.id) || []
    const count = documentCounts[cat.id] || 0
    const isSelected = selectedCategoryId === cat.id
    const isEditing = editingId === cat.id

    return (
      <div key={cat.id}>
        {isEditing ? (
          <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-7 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUpdate(cat.id)
                if (e.key === "Escape") setEditingId(null)
              }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleUpdate(cat.id)}>
              <Check className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingId(null)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
              isSelected
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => onSelectCategory(isSelected ? null : cat.id)}
          >
            {children.length > 0 ? (
              <FolderOpen className="h-4 w-4 shrink-0" />
            ) : (
              <Folder className="h-4 w-4 shrink-0" />
            )}
            <span className="flex-1 truncate">{cat.name}</span>
            <span className="text-xs text-muted-foreground">{count}</span>
            <div className="hidden group-hover:flex items-center gap-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingId(cat.id)
                  setEditName(cat.name)
                }}
                className="p-0.5 rounded hover:bg-muted"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteMutation.mutate(cat.id)
                }}
                className="p-0.5 rounded hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
            </div>
          </div>
        )}
        {children.map((child) => renderCategory(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="w-[220px] border-r bg-muted/30 flex flex-col shrink-0">
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold">{t("categories.title")}</h3>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-0.5">
        {/* All Documents */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
            selectedCategoryId === null
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          onClick={() => onSelectCategory(null)}
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="flex-1">{t("categories.all")}</span>
          <span className="text-xs text-muted-foreground">{totalDocuments}</span>
        </div>

        {/* Category tree */}
        {tree.roots.map((cat) => renderCategory(cat))}

        {/* Create new */}
        {isCreating ? (
          <div className="flex items-center gap-1 px-2 py-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("categories.name_placeholder")}
              className="h-7 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate()
                if (e.key === "Escape") {
                  setIsCreating(false)
                  setNewName("")
                }
              }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCreate}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground h-8"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("categories.new")}
          </Button>
        )}
      </div>
    </div>
  )
}
