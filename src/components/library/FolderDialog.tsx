import { useEffect, useState } from "react"
import type { Folder } from "../../../packages/types"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface FolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: Folder[]
  defaultParentId?: string | null
  loading?: boolean
  title: string
  confirmLabel: string
  cancelLabel: string
  onSubmit: (data: { name: string; parentId?: string }) => void
}

export function FolderDialog({
  open,
  onOpenChange,
  folders,
  defaultParentId = null,
  loading = false,
  title,
  confirmLabel,
  cancelLabel,
  onSubmit,
}: FolderDialogProps) {
  const [name, setName] = useState("")
  const [parentId, setParentId] = useState<string>("root")

  useEffect(() => {
    if (!open) {
      setName("")
      setParentId(defaultParentId || "root")
    }
  }, [defaultParentId, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={title}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) {
                onSubmit({
                  name: name.trim(),
                  parentId: parentId === "root" ? undefined : parentId,
                })
              }
            }}
          />
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="root">根目录</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                name: name.trim(),
                parentId: parentId === "root" ? undefined : parentId,
              })
            }
            disabled={loading || !name.trim()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
