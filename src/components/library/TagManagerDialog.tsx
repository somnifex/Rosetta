import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Pencil, Trash2, Check, X, Tags } from "lucide-react"

interface TagManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TagManagerDialog({ open, onOpenChange }: TagManagerDialogProps) {
  const { t } = useTranslation("library")
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState("#6366f1")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editColor, setEditColor] = useState("")

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: api.getTags,
  })

  const createMutation = useMutation({
    mutationFn: api.createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] })
      setNewName("")
      setNewColor("#6366f1")
    },
  })

  const updateMutation = useMutation({
    mutationFn: api.updateTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] })
      setEditingId(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] })
    },
  })

  const handleCreate = () => {
    if (newName.trim()) {
      createMutation.mutate({ name: newName.trim(), color: newColor })
    }
  }

  const handleUpdate = () => {
    if (editingId && editName.trim()) {
      updateMutation.mutate({ id: editingId, name: editName.trim(), color: editColor })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Tags className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base">{t("tags.manager_title")}</DialogTitle>
              <DialogDescription className="mt-0.5 text-sm">
                创建和管理文档标签，为你的文献建立标注体系
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Create new tag */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">新建标签</p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="h-9 w-9 cursor-pointer rounded-lg border border-border bg-background p-0.5"
                />
              </div>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("tags.name_placeholder")}
                className="h-9 flex-1 rounded-lg"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button size="sm" className="h-9 rounded-lg px-4 shadow-none" onClick={handleCreate} disabled={!newName.trim()}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t("tags.add")}
              </Button>
            </div>
          </div>

          {/* Tag list */}
          <div>
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              已有标签 · {tags.length}
            </p>
            <div className="max-h-[280px] space-y-1.5 overflow-auto">
              {tags.map((tag) =>
                editingId === tag.id ? (
                  <div key={tag.id} className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-8 w-8 cursor-pointer rounded-md border border-border bg-background p-0.5"
                    />
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 flex-1 rounded-md text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdate()
                        if (e.key === "Escape") setEditingId(null)
                      }}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-md" onClick={handleUpdate}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-md" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div key={tag.id} className="group flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/50">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/5"
                      style={{ backgroundColor: tag.color || "#6b7280" }}
                    />
                    <span className="flex-1 truncate text-sm text-foreground">{tag.name}</span>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md"
                        onClick={() => {
                          setEditingId(tag.id)
                          setEditName(tag.name)
                          setEditColor(tag.color || "#6b7280")
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(tag.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              )}
              {tags.length === 0 && (
                <div className="py-8 text-center">
                  <Tags className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {t("tags.empty")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
