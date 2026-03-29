import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, Trash2, Check, X } from "lucide-react"

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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("tags.manager_title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Create new tag */}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-8 w-8 rounded cursor-pointer border-0 p-0"
            />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("tags.name_placeholder")}
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              {t("tags.add")}
            </Button>
          </div>

          {/* Tag list */}
          <div className="space-y-2 max-h-[300px] overflow-auto">
            {tags.map((tag) =>
              editingId === tag.id ? (
                <div key={tag.id} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="h-8 w-8 rounded cursor-pointer border-0 p-0"
                  />
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUpdate()
                      if (e.key === "Escape") setEditingId(null)
                    }}
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleUpdate}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div key={tag.id} className="flex items-center gap-2 group">
                  <Badge
                    variant="secondary"
                    className="flex-1 justify-start gap-2 py-1.5"
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color || "#6b7280" }}
                    />
                    {tag.name}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
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
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteMutation.mutate(tag.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              )
            )}
            {tags.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("tags.empty")}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
