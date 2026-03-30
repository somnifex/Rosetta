import type { ReactNode } from "react"
import type { Category, Folder } from "../../../packages/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Archive,
  FileQuestion,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Layers3,
} from "lucide-react"

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
}: LibrarySidebarProps) {
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

  const renderCategory = (category: Category, depth = 0): ReactNode => {
    const children = categoryChildren.get(category.id) || []
    const categoryKey = `category:${category.id}`
    return (
      <div key={category.id}>
        <button
          type="button"
          className={navItemClass(activeSection === "library" && selectedCategoryKey === categoryKey)}
          style={{ paddingLeft: `${depth * 14 + 12}px` }}
          onClick={() => {
            onSelectSection("library")
            onSelectCategory(categoryKey)
          }}
        >
          {children.length > 0 ? <Layers3 className="h-4 w-4 shrink-0" /> : <FolderClosed className="h-4 w-4 shrink-0" />}
          <span className="flex-1 truncate text-left">{category.name}</span>
          <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px] font-normal shadow-none">
            {categoryCounts[category.id] || 0}
          </Badge>
        </button>
        {children.map((child) => renderCategory(child, depth + 1))}
      </div>
    )
  }

  const renderFolder = (folder: Folder, depth = 0): ReactNode => {
    const children = folderChildren.get(folder.id) || []
    return (
      <div key={folder.id}>
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

        <div className="space-y-2">
          <div className="flex items-center justify-between px-2 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              分类
            </p>
          </div>
          <div className="space-y-1">
            {rootCategories.map((category) => renderCategory(category))}
          </div>
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
          <div className="space-y-1">
            {rootFolders.map((folder) => renderFolder(folder))}
          </div>
        </div>
      </div>
    </aside>
  )
}
