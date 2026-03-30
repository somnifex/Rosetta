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
    <div className="flex items-center gap-2 flex-wrap">
      <Tags className="h-4 w-4 text-muted-foreground shrink-0" />
      {tags.map((tag) => {
        const isSelected = selectedTagIds.includes(tag.id)
        return (
          <Badge
            key={tag.id}
            variant={isSelected ? "default" : "outline"}
            className={cn(
              "rounded-full cursor-pointer shadow-none font-normal transition-colors",
              isSelected && tag.color && `bg-[${tag.color}] hover:bg-[${tag.color}]/80`
            )}
            style={isSelected && tag.color ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
            onClick={() => onToggleTag(tag.id)}
          >
            {tag.color && !isSelected && (
              <span
                className="w-2 h-2 rounded-full mr-1.5 inline-block"
                style={{ backgroundColor: tag.color }}
              />
            )}
            {tag.name}
          </Badge>
        )
      })}
      {selectedTagIds.length > 0 && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearTags}>
          <X className="h-3 w-3 mr-1" />
          {t("tags.clear")}
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={onManageTags}>
        {t("tags.manage")}
      </Button>
    </div>
  )
}
