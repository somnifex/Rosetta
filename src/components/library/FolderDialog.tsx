import { useEffect, useState } from "react"
import type { Folder } from "../../../packages/types"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { FolderPlus } from "lucide-react"

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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base">{title}</DialogTitle>
              <DialogDescription className="mt-0.5 text-sm">
                为文件夹设置名称和父级目录
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">文件夹名称</label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="输入文件夹名称"
              className="h-10 rounded-lg"
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) {
                  onSubmit({
                    name: name.trim(),
                    parentId: parentId === "root" ? undefined : parentId,
                  })
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">上级目录</label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="h-10 rounded-lg">
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
        </div>

        <DialogFooter className="gap-2 pt-2 sm:gap-2">
          <Button variant="outline" className="rounded-lg shadow-none" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            className="rounded-lg shadow-none"
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
