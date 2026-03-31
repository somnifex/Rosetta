import type { Tag } from "../../../packages/types"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface BatchTagDialogProps {
  open: boolean
  mode: "add" | "remove"
  tags: Tag[]
  onConfirm: (tagIds: string[]) => void
  onClose: () => void
}

export function BatchTagDialog({
  open,
  mode,
  tags,
  onConfirm,
  onClose,
}: BatchTagDialogProps) {
  const { t } = useTranslation("library")
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  const handleConfirm = () => {
    onConfirm(Array.from(selectedTagIds))
    setSelectedTagIds(new Set())
    onClose()
  }

  const handleClose = () => {
    setSelectedTagIds(new Set())
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? t("batch.tag_dialog_title_add") : t("batch.tag_dialog_title_remove")}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-64 space-y-1 overflow-y-auto py-2">
          {tags.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("batch.tag_dialog_empty")}</p>
          ) : (
            tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                  selectedTagIds.has(tag.id) ? "bg-accent" : ""
                }`}
                onClick={() => toggleTag(tag.id)}
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    selectedTagIds.has(tag.id) ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}
                >
                  {selectedTagIds.has(tag.id) && (
                    <svg className="h-3 w-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                {tag.color && (
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                )}
                <span>{tag.name}</span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t("batch.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={selectedTagIds.size === 0}>
            {mode === "add" ? t("batch.tag_dialog_confirm_add") : t("batch.tag_dialog_confirm_remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
