import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { getActiveProvidersForType, getPrimaryModelForType } from "@/lib/providers"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ExtractFieldsDialogProps {
  open: boolean
  documentIds: string[]
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}

export function ExtractFieldsDialog({
  open,
  documentIds,
  onOpenChange,
  onCompleted,
}: ExtractFieldsDialogProps) {
  const { t } = useTranslation("library")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const [providerId, setProviderId] = useState("")
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>([])

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
    enabled: open,
  })
  const { data: templates = [] } = useQuery({
    queryKey: ["extractionTemplates"],
    queryFn: api.getExtractionTemplates,
    enabled: open,
  })
  const { data: defaultProviderId } = useQuery({
    queryKey: ["extractionProviderId"],
    queryFn: api.getExtractionProviderId,
    enabled: open,
  })

  const chatProviders = useMemo(
    () => getActiveProvidersForType(providers, "chat"),
    [providers]
  )
  const enabledTemplates = useMemo(
    () => templates.filter((template) => template.is_enabled),
    [templates]
  )
  const availableFieldKeys = useMemo(
    () => enabledTemplates.map((template) => template.field_key),
    [enabledTemplates]
  )

  useEffect(() => {
    if (!open) return

    const nextProviderId =
      (defaultProviderId && chatProviders.some((provider) => provider.id === defaultProviderId)
        ? defaultProviderId
        : chatProviders[0]?.id) || ""
    setProviderId(nextProviderId)

    setSelectedFieldKeys((current) => {
      const nextKeys = availableFieldKeys
      if (nextKeys.length === 0) return []
      if (current.length > 0 && current.every((fieldKey) => nextKeys.includes(fieldKey))) {
        return current
      }
      return nextKeys
    })
  }, [availableFieldKeys, chatProviders, defaultProviderId, open])

  const extractMutation = useMutation({
    mutationFn: async () => {
      if (documentIds.length === 1) {
        return api.extractDocumentFields({
          documentId: documentIds[0],
          providerId,
          fieldKeys: selectedFieldKeys,
        })
      }

      return api.batchExtractDocumentFields({
        documentIds,
        providerId,
        fieldKeys: selectedFieldKeys,
      })
    },
    onSuccess: (result) => {
      if (Array.isArray(result)) {
        toast({
          title: t("extraction.toast.single_success"),
          description: t("extraction.toast.single_success_desc", {
            count: result.length,
          }),
        })
      } else {
        toast({
          title:
            result.failed > 0
              ? t("extraction.toast.batch_partial")
              : t("extraction.toast.batch_success"),
          description: t("batch.result_summary", {
            success: result.succeeded,
            failed: result.failed,
          }),
          variant: result.failed > 0 ? "destructive" : "default",
        })
      }
      onOpenChange(false)
      onCompleted?.()
    },
    onError: (error: Error) =>
      toast({
        title: t("extraction.toast.run_error"),
        description: error.message,
        variant: "destructive",
      }),
  })

  const selectedProvider = chatProviders.find((provider) => provider.id === providerId) || null
  const canSubmit =
    documentIds.length > 0 &&
    !!providerId &&
    selectedFieldKeys.length > 0 &&
    enabledTemplates.length > 0

  const dialogTitle =
    documentIds.length === 1
      ? t("extraction.dialog.single_title")
      : t("extraction.dialog.batch_title", { count: documentIds.length })
  const dialogDescription =
    documentIds.length === 1
      ? t("extraction.dialog.single_description")
      : t("extraction.dialog.batch_description")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("extraction.dialog.provider_label")}</label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="rounded-lg">
                <SelectValue placeholder={t("extraction.dialog.provider_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {chatProviders.map((provider) => {
                  const model = getPrimaryModelForType(provider, "chat")
                  return (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                      {model ? ` / ${model.model_name}` : ""}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedProvider
                ? t("extraction.dialog.provider_hint", { provider: selectedProvider.name })
                : t("extraction.dialog.provider_empty")}
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("extraction.dialog.fields_label")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("extraction.dialog.fields_hint")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg shadow-none"
                  onClick={() => setSelectedFieldKeys(availableFieldKeys)}
                  disabled={availableFieldKeys.length === 0}
                >
                  {t("extraction.dialog.select_all")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg shadow-none"
                  onClick={() => setSelectedFieldKeys([])}
                  disabled={selectedFieldKeys.length === 0}
                >
                  {t("extraction.dialog.clear")}
                </Button>
              </div>
            </div>

            {enabledTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {t("extraction.dialog.no_templates")}
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {enabledTemplates.map((template) => {
                  const selected = selectedFieldKeys.includes(template.field_key)
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-accent/40"
                      }`}
                      onClick={() =>
                        setSelectedFieldKeys((current) =>
                          current.includes(template.field_key)
                            ? current.filter((fieldKey) => fieldKey !== template.field_key)
                            : [...current, template.field_key]
                        )
                      }
                    >
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{template.name}</p>
                        <Badge variant="outline" className="rounded-full font-mono text-[11px]">
                          {template.field_key}
                        </Badge>
                      </div>
                      {template.description ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {template.description}
                        </p>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 sm:gap-2">
          <Button
            variant="outline"
            className="rounded-lg shadow-none"
            onClick={() => onOpenChange(false)}
            disabled={extractMutation.isPending}
          >
            {tc("btn.cancel")}
          </Button>
          <Button
            className="rounded-lg shadow-none"
            disabled={!canSubmit || extractMutation.isPending}
            onClick={() => extractMutation.mutate()}
          >
            {extractMutation.isPending
              ? t("extraction.dialog.running")
              : t("extraction.dialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
