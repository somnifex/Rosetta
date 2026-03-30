import { useState } from "react"
import type { ReactNode } from "react"
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
                className={navItemClass(activeSection === "library" && selectedCategoryKey === categoryKey)}
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
                <span className="flex-1 truncate text-left">{category.name}</span>
                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px] font-normal shadow-none">
                  {categoryCounts[category.id] || 0}
                </Badge>
              </button>
              {/* Hover action buttons */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEditingCategoryId(category.id)
                setEditCategoryName(category.name)
              }}
              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteCategory(category.id)
              }}
              className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onClick={() => {
              setEditingCategoryId(category.id)
              setEditCategoryName(category.name)
            }}>
              重命名分类
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteCategory(category.id)}>
              删除分类
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
          className={navItemClass(activeSection === "library" && selectedFolderId === folder.id)}
          style={{ paddingLeft: `${depth * 14 + 12}px` }}
          onClick={() => {
            onSelectSection("library")
            onSelectFolder(folder.id)
          }}
        >
          {children.length > 0 ? <FolderOpen className="h-4 w-4 shrink-0" /> : <FolderClosed className="h-4 w-4 shrink-0" />}
          <span className="flex-1 truncate text-left">{folder.name}</span>
          <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px] font-normal shadow-none">
            {folderCounts[folder.id] || 0}
          </Badge>
        </button>
              {/* Hover action buttons */}
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingFolderId(folder.id)
                    setEditFolderName(folder.name)
                  }}
                  className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteFolder(folder.id)
                  }}
                  className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onClick={() => {
              setEditingFolderId(folder.id)
              setEditFolderName(folder.name)
            }}>
              重命名文件夹
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteFolder(folder.id)}>
              删除文件夹
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
          文档库
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground/80">
          分类、文件夹与回收站
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
            <span className="flex-1 text-left">全部文档</span>
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
            <span className="flex-1 text-left">未分类</span>
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
            <span className="flex-1 text-left">回收站</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px] font-normal shadow-none">
              {trashCount}
            </Badge>
          </button>
        </div>

        {/* Categories section with CRUD */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-2 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              分类
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
          {/* Inline create category */}
          {isCreatingCategory && (
            <div className="flex items-center gap-1 px-2 py-1">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="分类名称"
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
              文件夹
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
            <span className="flex-1 text-left">根目录</span>
          </button>
          <div className="space-y-0.5 ml-2 border-l border-border/50">
            {rootFolders.map((folder) => renderFolder(folder, 1))}
          </div>
        </div>
      </div>
    </aside>
  )
}
