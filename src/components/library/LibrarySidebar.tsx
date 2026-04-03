import { useState } from "react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { Category, Folder } from "../../../packages/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Archive,
  Check,
  FileQuestion,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Layers3,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

interface LibrarySidebarProps {
  categories: Category[]
  folders: Folder[]
  categoryCounts: Record<string, number>
  folderCounts: Record<string, number>
  totalCount: number
  uncategorizedCount: number
  trashCount: number
  activeSection: "library" | "trash"
  selectedCategoryKey: string
  selectedFolderId: string | null
  onSelectSection: (section: "library" | "trash") => void
  onSelectCategory: (categoryKey: string) => void
  onSelectFolder: (folderId: string | null) => void
  onCreateFolder: () => void
  onUpdateFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onCreateCategory: (name: string) => void
  onUpdateCategory: (id: string, name: string) => void
  onDeleteCategory: (id: string) => void
}

function navItemClass(active: boolean) {
  return cn(
    "flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors mb-0.5",
    active
      ? "bg-primary text-primary-foreground font-medium"
      : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
  )
}

interface SidebarItemActionsProps {
  count: number
  active: boolean
  editLabel: string
  deleteLabel: string
  onEdit: () => void
  onDelete: () => void
}

function SidebarItemActions({
  count,
  active,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
}: SidebarItemActionsProps) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-2 flex w-[4.25rem] items-center justify-end">
      <Badge
        variant="secondary"
        className={cn(
          "pointer-events-none rounded-full px-2 py-0 text-[11px] font-normal shadow-none group-hover:hidden group-has-[:focus-visible]:hidden",
          active && "border-primary-foreground/15 bg-primary-foreground/15 text-primary-foreground"
        )}
      >
        {count}
      </Badge>

      <div className="pointer-events-auto z-10 hidden items-center gap-0.5 group-hover:flex group-has-[:focus-visible]:flex">
        <button
          type="button"
          aria-label={editLabel}
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className={cn(
            "rounded-md p-1 transition-colors",
            active
              ? "text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={deleteLabel}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className={cn(
            "rounded-md p-1 transition-colors",
            active
              ? "text-primary-foreground/80 hover:bg-destructive/20 hover:text-destructive"
              : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

export function LibrarySidebar({
  categories,
  folders,
  categoryCounts,
  folderCounts,
  totalCount,
  uncategorizedCount,
  trashCount,
  activeSection,
  selectedCategoryKey,
  selectedFolderId,
  onSelectSection,
  onSelectCategory,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: LibrarySidebarProps) {
  const { t } = useTranslation("library")
  const [isCreatingCategory, setIsCreatingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editCategoryName, setEditCategoryName] = useState("")
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editFolderName, setEditFolderName] = useState("")


  const categoryChildren = new Map<string, Category[]>()
  const rootCategories: Category[] = []

  for (const category of categories) {
    if (category.parent_id) {
      const current = categoryChildren.get(category.parent_id) || []
      current.push(category)
      categoryChildren.set(category.parent_id, current)
    } else {
      rootCategories.push(category)
    }
  }

  const folderChildren = new Map<string, Folder[]>()
  const rootFolders: Folder[] = []

  for (const folder of folders) {
    if (folder.parent_id) {
      const current = folderChildren.get(folder.parent_id) || []
      current.push(folder)
      folderChildren.set(folder.parent_id, current)
    } else {
      rootFolders.push(folder)
    }
  }

  const handleCreateCategory = () => {
    if (newCategoryName.trim()) {
      onCreateCategory(newCategoryName.trim())
      setNewCategoryName("")
      setIsCreatingCategory(false)
    }
  }

  const handleUpdateCategory = (id: string) => {
    if (editCategoryName.trim()) {
      onUpdateCategory(id, editCategoryName.trim())
      setEditingCategoryId(null)
      setEditCategoryName("")
    }
  }

  const handleUpdateFolder = (id: string) => {
    if (editFolderName.trim()) {
      onUpdateFolder(id, editFolderName.trim())
      setEditingFolderId(null)
      setEditFolderName("")
    }
  }

  const renderCategory = (category: Category, depth = 0): ReactNode => {
    const children = categoryChildren.get(category.id) || []
    const categoryKey = `category:${category.id}`
    const isEditing = editingCategoryId === category.id

    if (isEditing) {
      return (
        <div key={category.id}>
          <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
            <Input
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              className="h-7 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUpdateCategory(category.id)
                if (e.key === "Escape") {
                  setEditingCategoryId(null)
                  setEditCategoryName("")
                }
              }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleUpdateCategory(category.id)}>
              <Check className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setEditingCategoryId(null); setEditCategoryName("") }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          {children.map((child) => renderCategory(child, depth + 1))}
        </div>
      )
    }

    return (
      <div key={category.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="group relative">
              <button
                type="button"
                className={cn(navItemClass(activeSection === "library" && selectedCategoryKey === categoryKey), "pr-[4.75rem]")}
                style={{ paddingLeft: `${depth * 14 + 12}px` }}
                onClick={() => {
                  onSelectSection("library")
                  onSelectCategory(categoryKey)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                }}
              >
                {children.length > 0 ? <Layers3 className="h-4 w-4 shrink-0" /> : <FolderClosed className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-left">{category.name}</span>
              </button>
              <SidebarItemActions
                count={categoryCounts[category.id] || 0}
                active={activeSection === "library" && selectedCategoryKey === categoryKey}
                editLabel={t("categories.rename")}
                deleteLabel={t("categories.delete")}
                onEdit={() => {
                  setEditingCategoryId(category.id)
                  setEditCategoryName(category.name)
                }}
                onDelete={() => onDeleteCategory(category.id)}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onClick={() => {
              setEditingCategoryId(category.id)
              setEditCategoryName(category.name)
            }}>
              {t("categories.rename")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteCategory(category.id)}>
              {t("categories.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {children.map((child) => renderCategory(child, depth + 1))}
      </div>
    )
  }

  const renderFolder = (folder: Folder, depth = 0): ReactNode => {
    const children = folderChildren.get(folder.id) || []
    const isEditing = editingFolderId === folder.id

    if (isEditing) {
      return (
        <div key={folder.id}>
          <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
            <Input
              value={editFolderName}
              onChange={(e) => setEditFolderName(e.target.value)}
              className="h-7 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUpdateFolder(folder.id)
                if (e.key === "Escape") {
                  setEditingFolderId(null)
                  setEditFolderName("")
                }
              }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleUpdateFolder(folder.id)}>
              <Check className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setEditingFolderId(null); setEditFolderName("") }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          {children.map((child) => renderFolder(child, depth + 1))}
        </div>
      )
    }

    return (
      <div key={folder.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="group relative">
              <button
                type="button"
                className={cn(navItemClass(activeSection === "library" && selectedFolderId === folder.id), "pr-[4.75rem]")}
                style={{ paddingLeft: `${depth * 14 + 12}px` }}
                onClick={() => {
                  onSelectSection("library")
                  onSelectFolder(folder.id)
                }}
              >
                {children.length > 0 ? <FolderOpen className="h-4 w-4 shrink-0" /> : <FolderClosed className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
              </button>
              <SidebarItemActions
                count={folderCounts[folder.id] || 0}
                active={activeSection === "library" && selectedFolderId === folder.id}
                editLabel={t("folders.rename")}
                deleteLabel={t("folders.delete")}
                onEdit={() => {
                  setEditingFolderId(folder.id)
                  setEditFolderName(folder.name)
                }}
                onDelete={() => onDeleteFolder(folder.id)}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onClick={() => {
              setEditingFolderId(folder.id)
              setEditFolderName(folder.name)
            }}>
              {t("folders.rename")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteFolder(folder.id)}>
              {t("folders.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {children.map((child) => renderFolder(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-background xl:w-[280px]">
      <div className="border-b border-border px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("sidebar.title")}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground/80">
          {t("sidebar.subtitle")}
        </p>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <div className="space-y-1.5">
          <button
            type="button"
            className={navItemClass(activeSection === "library" && selectedCategoryKey === "all")}
            onClick={() => {
              onSelectSection("library")
              onSelectCategory("all")
              onSelectFolder(null)
            }}
          >
            <Layers3 className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("sidebar.all_documents")}</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px] font-normal shadow-none">
              {totalCount}
            </Badge>
          </button>
          <button
            type="button"
            className={navItemClass(activeSection === "library" && selectedCategoryKey === "uncategorized")}
            onClick={() => {
              onSelectSection("library")
              onSelectCategory("uncategorized")
              onSelectFolder(null)
            }}
          >
            <FileQuestion className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("sidebar.uncategorized")}</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px] font-normal shadow-none">
              {uncategorizedCount}
            </Badge>
          </button>
          <button
            type="button"
            className={navItemClass(activeSection === "trash")}
            onClick={() => onSelectSection("trash")}
          >
            <Archive className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("sidebar.trash")}</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px] font-normal shadow-none">
              {trashCount}
            </Badge>
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-2 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("sidebar.categories")}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={() => setIsCreatingCategory(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1">
            {rootCategories.map((category) => renderCategory(category))}
          </div>
          {isCreatingCategory && (
            <div className="flex items-center gap-1 px-2 py-1">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={t("categories.name_placeholder")}
                className="h-7 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCategory()
                  if (e.key === "Escape") {
                    setIsCreatingCategory(false)
                    setNewCategoryName("")
                  }
                }}
              />
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCreateCategory}>
                <Check className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setIsCreatingCategory(false); setNewCategoryName("") }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-2 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("sidebar.folders")}
            </p>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={onCreateFolder}>
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <button
            type="button"
            className={navItemClass(activeSection === "library" && selectedFolderId === null)}
            onClick={() => {
              onSelectSection("library")
              onSelectFolder(null)
            }}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("sidebar.root")}</span>
          </button>
          <div className="space-y-0.5 ml-2 border-l border-border/50">
            {rootFolders.map((folder) => renderFolder(folder, 1))}
          </div>
        </div>
      </div>
    </aside>
  )
}
