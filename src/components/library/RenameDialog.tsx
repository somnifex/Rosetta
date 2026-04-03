import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Document } from "../../../packages/types"

interface RenameDialogProps {
  document: Document | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (id: string, newTitle: string) => void
  loading?: boolean
}

export function RenameDialog({ document, open, onOpenChange, onConfirm, loading }: RenameDialogProps) {
  const { t } = useTranslation("library")
  const [title, setTitle] = useState("")

  useEffect(() => {
    if (document && open) {
      setTitle(document.title)
    }
  }, [document, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (document && title.trim() && title.trim() !== document.title) {
      onConfirm(document.id, title.trim())
      onOpenChange(false)
    } else {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("rename_dialog.title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title">{t("rename_dialog.name_label")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("rename_dialog.name_placeholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t("btn.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={loading || !title.trim() || (!!document && title.trim() === document.title)}
            >
              {t("btn.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
