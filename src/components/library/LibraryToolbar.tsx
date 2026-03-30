import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Grid3X3, List, Search, SlidersHorizontal } from "lucide-react"

type LibraryStatusKey = "all" | "completed" | "pending" | "processing" | "failed" | "deleted"
type ViewMode = "grid" | "list"
type SortField = "updated" | "created" | "name" | "size"

interface LibraryToolbarProps {
  title: string
  totalLabel: string
  searchQuery: string
  selectedStatus: LibraryStatusKey
  sortField: SortField
  viewMode: ViewMode
  selectionMode: boolean
  onSearchChange: (value: string) => void
  onStatusChange: (status: LibraryStatusKey) => void
  onSortChange: (sortField: SortField) => void
  onViewModeChange: (viewMode: ViewMode) => void
  onToggleSelectionMode: () => void
  uploadSlot: ReactNode
}

const statusOptions: Array<{ key: LibraryStatusKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "completed", label: "已完成" },
  { key: "pending", label: "未处理" },
  { key: "processing", label: "处理中" },
  { key: "failed", label: "失败" },
  { key: "deleted", label: "已删除" },
]

export function LibraryToolbar({
  title,
  totalLabel,
  searchQuery,
  selectedStatus,
  sortField,
  viewMode,
  selectionMode,
  onSearchChange,
  onStatusChange,
  onSortChange,
  onViewModeChange,
  onToggleSelectionMode,
  uploadSlot,
}: LibraryToolbarProps) {
  return (
    <div className="sticky top-0 z-20 space-y-4 bg-background/95 px-4 py-5 backdrop-blur sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{totalLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={selectionMode ? "default" : "outline"}
            className="gap-2 rounded-lg shadow-none"
            onClick={onToggleSelectionMode}
          >
            <SlidersHorizontal className="h-4 w-4" />
            批量管理
          </Button>
          {uploadSlot}
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索标题、文件名、标签、分类或文件夹"
            className="h-10 rounded-full bg-muted border-none pl-10 shadow-none focus-visible:ring-1"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={sortField} onValueChange={(value) => onSortChange(value as SortField)}>
            <SelectTrigger className="h-10 w-[180px] rounded-full border border-border bg-background shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">最近更新</SelectItem>
              <SelectItem value="created">创建时间</SelectItem>
              <SelectItem value="name">名称</SelectItem>
              <SelectItem value="size">大小</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex rounded-full border border-border bg-background p-0.5 shadow-none">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 rounded-full", viewMode === "grid" && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
              onClick={() => onViewModeChange("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 rounded-full", viewMode === "list" && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
              onClick={() => onViewModeChange("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {statusOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onStatusChange(option.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm shadow-none transition-colors",
              selectedStatus === option.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
