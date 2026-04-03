import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ExtractionTemplate, ExtractionTemplateInput } from "../../../packages/types"
import { api } from "@/lib/api"
import { getActiveProvidersForType, getPrimaryModelForType } from "@/lib/providers"
import { useToast } from "@/hooks/use-toast"
import { ExtractionTemplateDialog } from "@/components/settings/ExtractionTemplateDialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Plus, Pencil, Trash2 } from "lucide-react"

export default function ExtractionTab() {
  const { t } = useTranslation("settings")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ExtractionTemplate | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
  })
  const { data: templates = [] } = useQuery({
    queryKey: ["extractionTemplates"],
    queryFn: api.getExtractionTemplates,
  })
  const { data: extractionProviderId } = useQuery({
    queryKey: ["extractionProviderId"],
    queryFn: api.getExtractionProviderId,
  })

  const chatProviders = useMemo(
    () => getActiveProvidersForType(providers, "chat"),
    [providers]
  )
  const builtinTemplates = useMemo(
    () => templates.filter((template) => template.is_builtin),
    [templates]
  )
  const customTemplates = useMemo(
    () => templates.filter((template) => !template.is_builtin),
    [templates]
  )

  const providerMutation = useMutation({
    mutationFn: api.setExtractionProviderId,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extractionProviderId"] })
      toast({ title: t("extraction.toast.provider_saved") })
    },
    onError: (error: Error) =>
      toast({
        title: t("extraction.toast.provider_save_error"),
        description: error.message,
        variant: "destructive",
      }),
  })

  const saveTemplateMutation = useMutation({
    mutationFn: async (payload: { id?: string; input: ExtractionTemplateInput }) => {
      if (payload.id) {
        return api.updateExtractionTemplate(payload.id, payload.input)
      }
      return api.createExtractionTemplate(payload.input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extractionTemplates"] })
      setDialogOpen(false)
      setEditingTemplate(null)
      toast({ title: t("extraction.toast.template_saved") })
    },
    onError: (error: Error) =>
      toast({
        title: t("extraction.toast.template_save_error"),
        description: error.message,
        variant: "destructive",
      }),
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: api.deleteExtractionTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extractionTemplates"] })
      toast({ title: t("extraction.toast.template_deleted") })
    },
    onError: (error: Error) =>
      toast({
        title: t("extraction.toast.template_delete_error"),
        description: error.message,
        variant: "destructive",
      }),
  })

  const toggleBuiltinMutation = useMutation({
    mutationFn: ({ fieldKey, enabled }: { fieldKey: string; enabled: boolean }) =>
      api.toggleBuiltinTemplate(fieldKey, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extractionTemplates"] })
    },
    onError: (error: Error) =>
      toast({
        title: t("extraction.toast.template_save_error"),
        description: error.message,
        variant: "destructive",
      }),
  })

  const toggleCustomMutation = useMutation({
    mutationFn: (template: ExtractionTemplate) =>
      api.updateExtractionTemplate(template.id, {
        name: template.name,
        fieldKey: template.field_key,
        description: template.description || "",
        systemPrompt: template.system_prompt,
        userPrompt: template.user_prompt,
        isEnabled: !template.is_enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extractionTemplates"] })
    },
    onError: (error: Error) =>
      toast({
        title: t("extraction.toast.template_save_error"),
        description: error.message,
        variant: "destructive",
      }),
  })

  const selectedProviderValue =
    extractionProviderId && chatProviders.some((provider) => provider.id === extractionProviderId)
      ? extractionProviderId
      : "auto"

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("extraction.provider.title")}</CardTitle>
            <CardDescription>{t("extraction.provider.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("extraction.provider.label")}</label>
              <Select
                value={selectedProviderValue}
                onValueChange={(value) =>
                  providerMutation.mutate(value === "auto" ? "" : value)
                }
              >
                <SelectTrigger className="rounded-lg" data-setting-key="extraction.provider_id">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("extraction.provider.auto")}</SelectItem>
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
                {chatProviders.length === 0
                  ? t("extraction.provider.empty")
                  : t("extraction.provider.hint")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("extraction.builtin.title")}</CardTitle>
            <CardDescription>{t("extraction.builtin.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {builtinTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{template.name}</p>
                    <Badge variant="outline" className="rounded-full font-mono text-[11px]">
                      {template.field_key}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {template.description || t("extraction.builtin.no_description")}
                  </p>
                </div>
                <Switch
                  checked={template.is_enabled}
                  onCheckedChange={(checked) =>
                    toggleBuiltinMutation.mutate({
                      fieldKey: template.field_key,
                      enabled: checked,
                    })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{t("extraction.custom.title")}</CardTitle>
                <CardDescription>{t("extraction.custom.description")}</CardDescription>
              </div>
              <Button
                className="rounded-lg shadow-none"
                onClick={() => {
                  setEditingTemplate(null)
                  setDialogOpen(true)
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {t("extraction.custom.add")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {customTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {t("extraction.custom.empty")}
              </div>
            ) : (
              customTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{template.name}</p>
                      <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
                        {template.field_key}
                      </Badge>
                    </div>
                    {template.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={template.is_enabled}
                      onCheckedChange={() => toggleCustomMutation.mutate(template)}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-lg shadow-none"
                      onClick={() => {
                        setEditingTemplate(template)
                        setDialogOpen(true)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-destructive shadow-none hover:text-destructive"
                      onClick={() => deleteTemplateMutation.mutate(template.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <ExtractionTemplateDialog
        open={dialogOpen}
        template={editingTemplate}
        loading={saveTemplateMutation.isPending}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditingTemplate(null)
        }}
        onSubmit={(input) =>
          saveTemplateMutation.mutate({
            id: editingTemplate?.id,
            input,
          })
        }
      />
    </>
  )
}
