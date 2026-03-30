import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, X, Search } from "lucide-react"

interface TagPickerProps {
  documentId: string
}

export function TagPicker({ documentId }: TagPickerProps) {
  const { t } = useTranslation("document")
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState("")

  const { data: documentTags = [] } = useQuery({
    queryKey: ["documentTags", documentId],
    queryFn: () => api.getDocumentTags(documentId),
  })

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: api.getTags,
  })

  const addMutation = useMutation({
    mutationFn: (tagId: string) => api.addDocumentTags(documentId, [tagId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentTags", documentId] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (tagId: string) => api.removeDocumentTag(documentId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentTags", documentId] })
    },
  })

  const docTagIds = new Set(documentTags.map((t) => t.id))
  const availableTags = allTags.filter(
    (t) =>
      !docTagIds.has(t.id) &&
      t.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-2.5">
      {/* Current tags */}
      <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
        {documentTags.map((tag) => (
          <Badge
            key={tag.id}
            variant="secondary"
            className="gap-1.5 rounded-full py-1 pr-1.5 pl-2 shadow-none font-normal text-xs bg-muted text-foreground"
          >
            {tag.color && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
            )}
            {tag.name}
            <button
              onClick={() => removeMutation.mutate(tag.id)}
              className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-full border-dashed px-2.5 text-xs text-muted-foreground shadow-none hover:text-foreground"
          onClick={() => setIsOpen(!isOpen)}
        >
          <Plus className="h-3 w-3" />
          {t("tags.add")}
        </Button>
      </div>

      {/* Tag picker dropdown */}
      {isOpen && (
        <div className="rounded-lg border border-border bg-background p-2 space-y-2 shadow-sm">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tags.search")}
              className="h-8 rounded-md pl-8 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-[160px] overflow-auto space-y-0.5">
            {availableTags.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                {t("tags.no_available")}
              </p>
            ) : (
              availableTags.map((tag) => (
                <button
                  key={tag.id}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm hover:bg-muted transition-colors text-left"
                  onClick={() => {
                    addMutation.mutate(tag.id)
                  }}
                >
                  {tag.color && (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/5"
                      style={{ backgroundColor: tag.color }}
                    />
                  )}
                  <span className="truncate">{tag.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
