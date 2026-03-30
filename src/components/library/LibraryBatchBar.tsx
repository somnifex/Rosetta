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
    <div className="sticky top-[212px] z-10 mx-4 mt-4 rounded-lg border border-border bg-background p-4 shadow-sm sm:mx-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-primary">
            <CheckSquare className="h-4 w-4" />
            已选 {selectedCount} 项
          </div>
          <Button variant="ghost" size="sm" onClick={onSelectAll} disabled={currentViewIds.length === 0}>
            全选当前视图
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="mr-1 h-4 w-4" />
            退出批量模式
          </Button>
        </div>

        {activeSection === "library" ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex gap-2">
              <Select value={categoryDraft} onValueChange={setCategoryDraft}>
                <SelectTrigger className="w-[180px]">
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
                onClick={() => onApplyCategory(categoryDraft === "__clear__" ? "" : categoryDraft)}
                disabled={!categoryDraft || selectedCount === 0}
              >
                应用分类
              </Button>
            </div>
            <div className="flex gap-2">
              <Select value={folderDraft} onValueChange={setFolderDraft}>
                <SelectTrigger className="w-[180px]">
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
                onClick={() => onApplyFolder(folderDraft === "__clear__" ? "" : folderDraft)}
                disabled={!folderDraft || selectedCount === 0}
              >
                应用文件夹
              </Button>
            </div>
            <Button variant="destructive" onClick={onDelete} disabled={selectedCount === 0}>
              <Trash2 className="mr-2 h-4 w-4" />
              移入回收站
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onRestore} disabled={selectedCount === 0}>
              <ArchiveRestore className="mr-2 h-4 w-4" />
              批量恢复
            </Button>
            <Button variant="destructive" onClick={onPermanentDelete} disabled={selectedCount === 0}>
              <Trash2 className="mr-2 h-4 w-4" />
              永久删除
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
