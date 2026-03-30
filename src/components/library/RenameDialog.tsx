import { useState, useEffect } from "react"
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
          <DialogTitle>重命名文档</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title">名称</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入文档新名称"
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
              取消
            </Button>
            <Button
              type="submit"
              disabled={loading || !title.trim() || (!!document && title.trim() === document.title)}
            >
              确定
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
