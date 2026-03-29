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
    <div className="space-y-2">
      {/* Current tags */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {documentTags.map((tag) => (
          <Badge
            key={tag.id}
            variant="secondary"
            className="gap-1 pr-1"
          >
            {tag.color && (
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
            )}
            {tag.name}
            <button
              onClick={() => removeMutation.mutate(tag.id)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setIsOpen(!isOpen)}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t("tags.add")}
        </Button>
      </div>

      {/* Tag picker dropdown */}
      {isOpen && (
        <div className="border rounded-lg p-2 space-y-2 bg-popover shadow-md">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tags.search")}
              className="h-8 pl-7 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-[150px] overflow-auto space-y-0.5">
            {availableTags.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                {t("tags.no_available")}
              </p>
            ) : (
              availableTags.map((tag) => (
                <button
                  key={tag.id}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded text-sm hover:bg-accent transition-colors text-left"
                  onClick={() => {
                    addMutation.mutate(tag.id)
                  }}
                >
                  {tag.color && (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                  )}
                  {tag.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
