import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Sparkles, Trash2 } from "lucide-react"

interface DocumentMetadataPanelProps {
  documentId: string
  onRequestExtract?: () => void
}

function humanizeFieldKey(fieldKey: string) {
  return fieldKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function formatDate(value?: string) {
  if (!value) return ""
  return new Date(value).toLocaleString()
}

export function DocumentMetadataPanel({
  documentId,
  onRequestExtract,
}: DocumentMetadataPanelProps) {
  const { t } = useTranslation("library")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ["documentMetadata", documentId],
    queryFn: () => api.getDocumentMetadata(documentId),
    enabled: !!documentId,
  })
  const { data: templates = [] } = useQuery({
    queryKey: ["extractionTemplates"],
    queryFn: api.getExtractionTemplates,
    enabled: !!documentId,
  })

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const template of templates) {
      map.set(template.field_key, template.name)
    }
    return map
  }, [templates])

  const deleteMutation = useMutation({
    mutationFn: (fieldKey: string) => api.deleteDocumentMetadataField(documentId, fieldKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentMetadata", documentId] })
      queryClient.invalidateQueries({ queryKey: ["documentMetadataBatch"] })
      toast({ title: t("extraction.toast.field_deleted") })
    },
    onError: (error: Error) =>
      toast({
        title: t("extraction.toast.field_delete_error"),
        description: error.message,
        variant: "destructive",
      }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">{t("extraction.metadata.title")}</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("extraction.metadata.description")}
          </p>
        </div>
        {onRequestExtract ? (
          <Button
            size="sm"
            className="rounded-lg shadow-none"
            onClick={onRequestExtract}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {t("extraction.metadata.extract")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-lg border p-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-12 w-full" />
            </div>
          ))}
        </div>
      ) : fields.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm font-medium">{t("extraction.metadata.empty_title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("extraction.metadata.empty_description")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => {
            const label = templateNameMap.get(field.field_key) || humanizeFieldKey(field.field_key)
            return (
              <div key={`${field.field_key}-${field.id}`} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{label}</p>
                      <Badge variant="outline" className="rounded-full font-mono text-[11px]">
                        {field.field_key}
                      </Badge>
                    </div>
                    {field.extracted_at ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("extraction.metadata.extracted_at", {
                          time: formatDate(field.extracted_at),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-destructive shadow-none hover:text-destructive"
                    onClick={() => deleteMutation.mutate(field.field_key)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {field.error ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-destructive">
                    {field.error}
                  </p>
                ) : field.field_value ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                    {field.field_value}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("extraction.metadata.not_found")}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
