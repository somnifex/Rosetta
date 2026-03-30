import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tags, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface TagFilterBarProps {
  selectedTagIds: string[]
  onToggleTag: (tagId: string) => void
  onClearTags: () => void
  onManageTags: () => void
}

export function TagFilterBar({
  selectedTagIds,
  onToggleTag,
  onClearTags,
  onManageTags,
}: TagFilterBarProps) {
  const { t } = useTranslation("library")

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: api.getTags,
  })

  if (tags.length === 0) {
    return null
  }

  return (
    <div className="px-4 pb-2 sm:px-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card/70 px-3 py-2">
        <Tags className="h-4 w-4 shrink-0 text-muted-foreground" />
        {tags.map((tag) => {
          const isSelected = selectedTagIds.includes(tag.id)
          return (
            <Badge
              key={tag.id}
              variant={isSelected ? "default" : "outline"}
              className={cn(
                "cursor-pointer rounded-full font-normal shadow-none transition-colors",
                isSelected && tag.color && `bg-[${tag.color}] hover:bg-[${tag.color}]/80`
              )}
              style={isSelected && tag.color ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
              onClick={() => onToggleTag(tag.id)}
            >
              {tag.color && !isSelected && (
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
              )}
              {tag.name}
            </Badge>
          )
        })}
        {selectedTagIds.length > 0 && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearTags}>
            <X className="mr-1 h-3 w-3" />
            {t("tags.clear")}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={onManageTags}>
          {t("tags.manage")}
        </Button>
      </div>
    </div>
  )
}
