import type { Category, Folder, Tag } from "../../../packages/types"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BatchTagDialog } from "./BatchTagDialog"
import { BatchLanguageDialog } from "./BatchLanguageDialog"
import { BatchExportDialog } from "./BatchExportDialog"
import {
  ArchiveRestore,
  CheckSquare,
  Download,
  FileCode2,
  Globe,
  Languages,
  Library,
  MoreHorizontal,
  Sparkles,
  Tag as TagIcon,
  Tags,
  Trash2,
  X,
} from "lucide-react"

interface LibraryBatchBarProps {
  activeSection: "library" | "trash"
  selectedCount: number
  categories: Category[]
  folders: Folder[]
  tags: Tag[]
  currentViewIds: string[]
  onSelectAll: () => void
  onClear: () => void
  onApplyCategory: (categoryId: string) => void
  onApplyFolder: (folderId: string) => void
  onDelete: () => void
  onRestore: () => void
  onPermanentDelete: () => void
  onBatchParse: () => void
  onBatchExtract: () => void
  onBatchTranslate: () => void
  onBatchIndex: () => void
  onBatchAddTags: (tagIds: string[]) => void
  onBatchRemoveTags: (tagIds: string[]) => void
  onBatchSetLanguage: (source?: string, target?: string) => void
  onBatchExport: (format: string, contentType: string, outputDir: string) => void
  isParsePending?: boolean
  isTranslatePending?: boolean
}

export function LibraryBatchBar({
  activeSection,
  selectedCount,
  categories,
  folders,
  tags,
  currentViewIds,
  onSelectAll,
  onClear,
  onApplyCategory,
  onApplyFolder,
  onDelete,
  onRestore,
  onPermanentDelete,
  onBatchParse,
  onBatchExtract,
  onBatchTranslate,
  onBatchIndex,
  onBatchAddTags,
  onBatchRemoveTags,
  onBatchSetLanguage,
  onBatchExport,
  isParsePending,
  isTranslatePending,
}: LibraryBatchBarProps) {
  const { t } = useTranslation("library")
  const [categoryDraft, setCategoryDraft] = useState<string>("")
  const [folderDraft, setFolderDraft] = useState<string>("")
  const [tagDialogMode, setTagDialogMode] = useState<"add" | "remove" | null>(null)
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-200">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
          {/* Selection info */}
          <div className="flex items-center gap-2 border-r border-border pr-3">
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
              <CheckSquare className="h-3.5 w-3.5" />
              {selectedCount}
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSelectAll} disabled={currentViewIds.length === 0}>
              {t("batch.select_all")}
            </Button>
          </div>

          {/* Actions */}
          {activeSection === "library" ? (
            <div className="flex items-center gap-2">
              {/* Pipeline actions */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onBatchParse}
                disabled={selectedCount === 0 || isParsePending}
              >
                <FileCode2 className="h-3.5 w-3.5" />
                {t("batch.parse")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onBatchExtract}
                disabled={selectedCount === 0}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t("batch.extract")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onBatchTranslate}
                disabled={selectedCount === 0 || isTranslatePending}
              >
                <Languages className="h-3.5 w-3.5" />
                {t("batch.translate")}
              </Button>

              <div className="mx-1 h-5 w-px bg-border" />

              {/* Category & Folder */}
              <Select value={categoryDraft} onValueChange={setCategoryDraft}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder={t("batch.set_category")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">{t("batch.clear_category")}</SelectItem>
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
                {t("batch.apply")}
              </Button>

              <div className="mx-1 h-5 w-px bg-border" />

              <Select value={folderDraft} onValueChange={setFolderDraft}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder={t("batch.move_to_folder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">{t("batch.remove_from_folder")}</SelectItem>
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
                {t("batch.apply")}
              </Button>

              <div className="mx-1 h-5 w-px bg-border" />

              {/* More dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    {t("batch.more")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  <DropdownMenuItem onClick={onBatchIndex} disabled={selectedCount === 0}>
                    <Library className="mr-2 h-4 w-4" />
                    {t("batch.index")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTagDialogMode("add")} disabled={selectedCount === 0}>
                    <TagIcon className="mr-2 h-4 w-4" />
                    {t("batch.add_tags")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTagDialogMode("remove")} disabled={selectedCount === 0}>
                    <Tags className="mr-2 h-4 w-4" />
                    {t("batch.remove_tags")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLanguageDialogOpen(true)} disabled={selectedCount === 0}>
                    <Globe className="mr-2 h-4 w-4" />
                    {t("batch.set_language")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setExportDialogOpen(true)} disabled={selectedCount === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("batch.export")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="mx-1 h-5 w-px bg-border" />

              <Button variant="destructive" size="sm" className="h-8 gap-1.5 text-xs" onClick={onDelete} disabled={selectedCount === 0}>
                <Trash2 className="h-3.5 w-3.5" />
                {t("batch.delete")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRestore} disabled={selectedCount === 0}>
                <ArchiveRestore className="h-3.5 w-3.5" />
                {t("batch.restore")}
              </Button>
              <Button variant="destructive" size="sm" className="h-8 gap-1.5 text-xs" onClick={onPermanentDelete} disabled={selectedCount === 0}>
                <Trash2 className="h-3.5 w-3.5" />
                {t("batch.permanent_delete")}
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

      {/* Dialogs */}
      <BatchTagDialog
        open={tagDialogMode !== null}
        mode={tagDialogMode ?? "add"}
        tags={tags}
        onConfirm={(tagIds) => {
          if (tagDialogMode === "add") onBatchAddTags(tagIds)
          else onBatchRemoveTags(tagIds)
        }}
        onClose={() => setTagDialogMode(null)}
      />
      <BatchLanguageDialog
        open={languageDialogOpen}
        onConfirm={onBatchSetLanguage}
        onClose={() => setLanguageDialogOpen(false)}
      />
      <BatchExportDialog
        open={exportDialogOpen}
        onConfirm={onBatchExport}
        onClose={() => setExportDialogOpen(false)}
      />
    </>
  )
}
