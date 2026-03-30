import type { Category, Folder } from "../../../packages/types"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ArchiveRestore, CheckSquare, Trash2, X } from "lucide-react"

interface LibraryBatchBarProps {
  activeSection: "library" | "trash"
  selectedCount: number
  categories: Category[]
  folders: Folder[]
  currentViewIds: string[]
  onSelectAll: () => void
  onClear: () => void
  onApplyCategory: (categoryId: string) => void
  onApplyFolder: (folderId: string) => void
  onDelete: () => void
  onRestore: () => void
  onPermanentDelete: () => void
}

export function LibraryBatchBar({
  activeSection,
  selectedCount,
  categories,
  folders,
  currentViewIds,
  onSelectAll,
  onClear,
  onApplyCategory,
  onApplyFolder,
  onDelete,
  onRestore,
  onPermanentDelete,
}: LibraryBatchBarProps) {
  const [categoryDraft, setCategoryDraft] = useState<string>("")
  const [folderDraft, setFolderDraft] = useState<string>("")

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
        {/* Selection info */}
        <div className="flex items-center gap-2 border-r border-border pr-3">
          <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
            <CheckSquare className="h-3.5 w-3.5" />
            {selectedCount}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSelectAll} disabled={currentViewIds.length === 0}>
            全选
          </Button>
        </div>

        {/* Actions */}
        {activeSection === "library" ? (
          <div className="flex items-center gap-2">
            <Select value={categoryDraft} onValueChange={setCategoryDraft}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="设置分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__">清空分类</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onApplyCategory(categoryDraft === "__clear__" ? "" : categoryDraft)}
              disabled={!categoryDraft || selectedCount === 0}
            >
              应用
            </Button>

            <div className="mx-1 h-5 w-px bg-border" />

            <Select value={folderDraft} onValueChange={setFolderDraft}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="移动到文件夹" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__">移出文件夹</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onApplyFolder(folderDraft === "__clear__" ? "" : folderDraft)}
              disabled={!folderDraft || selectedCount === 0}
            >
              应用
            </Button>

            <div className="mx-1 h-5 w-px bg-border" />

            <Button variant="destructive" size="sm" className="h-8 gap-1.5 text-xs" onClick={onDelete} disabled={selectedCount === 0}>
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRestore} disabled={selectedCount === 0}>
              <ArchiveRestore className="h-3.5 w-3.5" />
              恢复
            </Button>
            <Button variant="destructive" size="sm" className="h-8 gap-1.5 text-xs" onClick={onPermanentDelete} disabled={selectedCount === 0}>
              <Trash2 className="h-3.5 w-3.5" />
              永久删除
            </Button>
          </div>
        )}

        {/* Close */}
        <div className="border-l border-border pl-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
