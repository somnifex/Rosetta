import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { api, type ProviderModelInput, type ProviderUpsertInput } from "@/lib/api"
import { getActiveModelsForType } from "@/lib/providers"
import type { Provider, ProviderModel, ProviderModelType } from "../../../packages/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
  Eye,
  Languages,
  Layers,
  ListRestart,
  Loader2,
  MessageSquare,
  Network,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react"

type SamplingForm = {
  temperature: string
  top_p: string
  top_k: string
  max_tokens: string
}

const MODEL_TYPES: Array<{
  value: ProviderModelType
  label: string
  icon: typeof MessageSquare
  badgeClassName: string
}> = [
  { value: "chat", label: "Chat", icon: MessageSquare, badgeClassName: "bg-sky-50 text-sky-700 border-sky-200" },
  { value: "translate", label: "Translate", icon: Languages, badgeClassName: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "embed", label: "Embed", icon: Layers, badgeClassName: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "rerank", label: "Rerank", icon: ListRestart, badgeClassName: "bg-rose-50 text-rose-700 border-rose-200" },
]

const SAMPLING_FIELDS: Array<{ key: keyof SamplingForm; label: string }> = [
  { key: "temperature", label: "Temperature" },
  { key: "top_p", label: "Top P" },
  { key: "top_k", label: "Top K" },
  { key: "max_tokens", label: "Max Tokens" },
]

function emptySamplingForm(): SamplingForm {
  return { temperature: "", top_p: "", top_k: "", max_tokens: "" }
}

function emptyChannelForm(): ProviderUpsertInput {
  return {
    name: "",
    baseUrl: "",
    apiKey: "",
    maxRetries: 3,
    priority: 0,
    concurrency: 3,
    isActive: true,
    models: [],
  }
}

function emptyModelForm(): ProviderModelInput {
  return {
    name: "",
    modelType: "chat",
    modelName: "",
    supportsVision: false,
    isActive: true,
    priority: 0,
    config: {},
  }
}

function toSamplingForm(settings: Array<{ key: string; value: string }>, scope: "chat" | "translate"): SamplingForm {
  const map = new Map(settings.map((item) => [item.key, item.value]))
  return {
    temperature: map.get(`llm.${scope}.temperature`) ?? "",
    top_p: map.get(`llm.${scope}.top_p`) ?? "",
    top_k: map.get(`llm.${scope}.top_k`) ?? "",
    max_tokens: map.get(`llm.${scope}.max_tokens`) ?? "",
  }
}

function toProviderInput(provider: Provider): ProviderUpsertInput {
  return {
    name: provider.name,
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
    maxRetries: provider.max_retries,
    priority: provider.priority,
    timeout: provider.timeout,
    concurrency: provider.concurrency ?? 3,
    isActive: provider.is_active,
    models: (provider.models ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      modelType: model.model_type,
      modelName: model.model_name,
      supportsVision: model.supports_vision,
      isActive: model.is_active,
      priority: model.priority,
      config: {
        dimensions: model.config?.dimensions,
        rerank_top_n: model.config?.rerank_top_n,
      },
    })),
  }
}

function getModelCount(provider: Provider, modelType: ProviderModelType) {
  return (provider.models ?? []).filter((model) => model.model_type === modelType).length
}

function modelConfigSummary(model: ProviderModel, t: any) {
  if (model.model_type === "embed" && model.config?.dimensions) {
    return t("providers_manager.summary.dimensions", { value: model.config.dimensions })
  }
  if (model.model_type === "rerank" && model.config?.rerank_top_n) return `Top N ${model.config.rerank_top_n}`
  if ((model.model_type === "chat" || model.model_type === "translate") && model.supports_vision) return t("providers_manager.summary.vision")
  return t("providers_manager.summary.default")
}

export default function ProvidersTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Provider | null>(null)
  const [channelForm, setChannelForm] = useState<ProviderUpsertInput>(emptyChannelForm())

  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [modelTargetChannel, setModelTargetChannel] = useState<Provider | null>(null)
  const [editingModel, setEditingModel] = useState<ProviderModel | null>(null)
  const [modelForm, setModelForm] = useState<ProviderModelInput>(emptyModelForm())

  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [failoverEnabled, setFailoverEnabled] = useState(true)
  const [chatSampling, setChatSampling] = useState<SamplingForm>(emptySamplingForm())
  const [translateSampling, setTranslateSampling] = useState<SamplingForm>(emptySamplingForm())

  const { data: providers = [], isLoading: providersLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
  })

  const { data: appSettings = [] } = useQuery({
    queryKey: ["appSettings"],
    queryFn: api.getAllAppSettings,
  })

  useEffect(() => {
    if (settingsLoaded || appSettings.length === 0) return
    setChatSampling(toSamplingForm(appSettings, "chat"))
    setTranslateSampling(toSamplingForm(appSettings, "translate"))
    setFailoverEnabled(appSettings.find((item) => item.key === "llm.failover_enabled")?.value !== "false")
    setSettingsLoaded(true)
  }, [appSettings, settingsLoaded])

  const invalidateSettings = () => {
    queryClient.invalidateQueries({ queryKey: ["providers"] })
    queryClient.invalidateQueries({ queryKey: ["appSettings"] })
  }

  const saveGlobalMutation = useMutation({
    mutationFn: async () => {
      const writes: Array<[string, string]> = [
        ["llm.failover_enabled", failoverEnabled ? "true" : "false"],
        ["llm.chat.temperature", chatSampling.temperature.trim()],
        ["llm.chat.top_p", chatSampling.top_p.trim()],
        ["llm.chat.top_k", chatSampling.top_k.trim()],
        ["llm.chat.max_tokens", chatSampling.max_tokens.trim()],
        ["llm.translate.temperature", translateSampling.temperature.trim()],
        ["llm.translate.top_p", translateSampling.top_p.trim()],
        ["llm.translate.top_k", translateSampling.top_k.trim()],
        ["llm.translate.max_tokens", translateSampling.max_tokens.trim()],
      ]
      for (const [key, value] of writes) {
        await api.setAppSetting(key, value)
      }
    },
    onSuccess: () => {
      invalidateSettings()
      toast({ title: t("providers_manager.toast.global_saved") })
    },
    onError: (error: Error) => {
      toast({ title: t("providers_manager.toast.global_save_error"), description: error.message, variant: "destructive" })
    },
  })

  const saveChannelMutation = useMutation({
    mutationFn: async (payload: { id?: string; input: ProviderUpsertInput }) => {
      if (payload.id) return api.updateProvider(payload.id, payload.input)
      return api.createProvider(payload.input)
    },
    onSuccess: () => {
      invalidateSettings()
      setChannelDialogOpen(false)
      setEditingChannel(null)
      setChannelForm(emptyChannelForm())
      toast({ title: t("providers_manager.toast.channel_saved") })
    },
    onError: (error: Error) => {
      toast({ title: t("providers_manager.toast.channel_save_error"), description: error.message, variant: "destructive" })
    },
  })

  const deleteChannelMutation = useMutation({
    mutationFn: api.deleteProvider,
    onSuccess: () => {
      invalidateSettings()
      toast({ title: t("providers_manager.toast.channel_deleted") })
    },
    onError: (error: Error) => {
      toast({ title: t("providers_manager.toast.channel_delete_error"), description: error.message, variant: "destructive" })
    },
  })

  const saveModelMutation = useMutation({
    mutationFn: async (payload: { channel: Provider; models: ProviderModelInput[] }) =>
      api.updateProvider(payload.channel.id, { ...toProviderInput(payload.channel), models: payload.models }),
    onSuccess: () => {
      invalidateSettings()
      setModelDialogOpen(false)
      setModelTargetChannel(null)
      setEditingModel(null)
      setModelForm(emptyModelForm())
      toast({ title: t("providers_manager.toast.model_saved") })
    },
    onError: (error: Error) => {
      toast({ title: t("providers_manager.toast.model_save_error"), description: error.message, variant: "destructive" })
    },
  })

  const openCreateChannel = () => {
    setEditingChannel(null)
    setChannelForm(emptyChannelForm())
    setChannelDialogOpen(true)
  }

  const openEditChannel = (provider: Provider) => {
    setEditingChannel(provider)
    setChannelForm(toProviderInput(provider))
    setChannelDialogOpen(true)
  }

  const openCreateModel = (provider: Provider) => {
    setModelTargetChannel(provider)
    setEditingModel(null)
    setModelForm({ ...emptyModelForm(), priority: (provider.models ?? []).length })
    setModelDialogOpen(true)
  }

  const openEditModel = (provider: Provider, model: ProviderModel) => {
    setModelTargetChannel(provider)
    setEditingModel(model)
    setModelForm({
      id: model.id,
      name: model.name,
      modelType: model.model_type,
      modelName: model.model_name,
      supportsVision: model.supports_vision,
      isActive: model.is_active,
      priority: model.priority,
      config: {
        dimensions: model.config?.dimensions,
        rerank_top_n: model.config?.rerank_top_n,
      },
    })
    setModelDialogOpen(true)
  }

  const handleSaveChannel = () => {
    if (!channelForm.name.trim() || !channelForm.baseUrl.trim() || !channelForm.apiKey.trim()) {
      toast({
        title: t("providers_manager.validation.channel_title"),
        description: t("providers_manager.validation.channel_description"),
        variant: "destructive",
      })
      return
    }

    saveChannelMutation.mutate({
      id: editingChannel?.id,
      input: {
        ...channelForm,
        name: channelForm.name.trim(),
        baseUrl: channelForm.baseUrl.trim(),
        apiKey: channelForm.apiKey.trim(),
      },
    })
  }

  const handleSaveModel = () => {
    if (!modelTargetChannel) return
    if (!modelForm.name?.trim() || !modelForm.modelName?.trim()) {
      toast({
        title: t("providers_manager.validation.model_title"),
        description: t("providers_manager.validation.model_description"),
        variant: "destructive",
      })
      return
    }

    const nextModel: ProviderModelInput = {
      ...modelForm,
      id: editingModel?.id ?? modelForm.id,
      name: modelForm.name.trim(),
      modelName: modelForm.modelName.trim(),
      config: {
        dimensions: modelForm.config?.dimensions,
        rerank_top_n: modelForm.config?.rerank_top_n,
      },
    }

    const currentModels = toProviderInput(modelTargetChannel).models
    const nextModels = editingModel
      ? currentModels.map((item) => (item.id === editingModel.id ? nextModel : item))
      : [...currentModels, nextModel]

    saveModelMutation.mutate({ channel: modelTargetChannel, models: nextModels })
  }

  const handleDeleteModel = (provider: Provider, model: ProviderModel) => {
    const nextModels = toProviderInput(provider).models.filter((item) => item.id !== model.id)
    saveModelMutation.mutate({ channel: provider, models: nextModels })
  }

  const handleToggleChannel = (provider: Provider, checked: boolean) => {
    saveChannelMutation.mutate({
      id: provider.id,
      input: {
        ...toProviderInput(provider),
        isActive: checked,
      },
    })
  }

  const handleToggleModel = (provider: Provider, model: ProviderModel, checked: boolean) => {
    const nextModels = toProviderInput(provider).models.map((item) =>
      item.id === model.id ? { ...item, isActive: checked } : item
    )
    saveModelMutation.mutate({ channel: provider, models: nextModels })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" />
                {t("providers_manager.section_title")}
              </CardTitle>
              <CardDescription>
                {t("providers_manager.section_description")}
              </CardDescription>
            </div>
            <Button onClick={openCreateChannel}>
              <Plus className="mr-2 h-4 w-4" />
              {t("providers_manager.new_channel")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
            <div>
              <p className="font-medium text-sm">{t("providers.failover.label")}</p>
              <p className="text-xs text-muted-foreground">{t("providers.failover.description")}</p>
            </div>
            <Switch data-setting-key="llm.failover_enabled" checked={failoverEnabled} onCheckedChange={setFailoverEnabled} />
          </div>

          {providersLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("providers_manager.loading")}
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              {t("providers_manager.empty")}
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => (
                <div key={provider.id} className="rounded-xl border bg-card shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2">
                          <Network className="h-4 w-4 text-primary" />
                          <span className="font-semibold">{provider.name}</span>
                        </div>
                        <Badge variant={provider.is_active ? "default" : "outline"}>
                          {provider.is_active ? t("providers_manager.enabled") : t("providers_manager.disabled")}
                        </Badge>
                        <Badge variant="outline">{t("providers_manager.priority", { value: provider.priority })}</Badge>
                        <Badge variant="outline">{t("providers_manager.retries", { value: provider.max_retries })}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground break-all">{provider.base_url}</p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Chat {getModelCount(provider, "chat")}</span>
                        <span>Translate {getModelCount(provider, "translate")}</span>
                        <span>Embed {getModelCount(provider, "embed")}</span>
                        <span>Rerank {getModelCount(provider, "rerank")}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                        <span className="text-xs text-muted-foreground">{t("providers_manager.channel_enabled")}</span>
                        <Switch checked={provider.is_active} onCheckedChange={(checked) => handleToggleChannel(provider, checked)} />
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openEditChannel(provider)}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        {t("providers_manager.edit_channel")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openCreateModel(provider)}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {t("providers_manager.add_model")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteChannelMutation.mutate(provider.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 px-4 py-4">
                    {(provider.models ?? []).length === 0 ? (
                      <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        {t("providers_manager.no_models")}
                      </div>
                    ) : (
                      provider.models.map((model) => {
                        const meta = MODEL_TYPES.find((item) => item.value === model.model_type) ?? MODEL_TYPES[0]
                        const Icon = meta.icon
                        const isPrimary = getActiveModelsForType(provider, model.model_type)[0]?.id === model.id

                        return (
                          <div key={model.id} className="rounded-lg border bg-background px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className={meta.badgeClassName}>
                                    <Icon className="mr-1 h-3 w-3" />
                                    {meta.label}
                                  </Badge>
                                  <span className="font-medium">{model.name}</span>
                                  <Badge variant="outline">{model.model_name}</Badge>
                                  {isPrimary && <Badge variant="secondary">{t("providers_manager.default_badge")}</Badge>}
                                  {!model.is_active && <Badge variant="outline">{t("providers_manager.disabled_badge")}</Badge>}
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <span>{t("providers_manager.priority", { value: model.priority })}</span>
                                  <span>{modelConfigSummary(model, t)}</span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                                  <span className="text-xs text-muted-foreground">{t("providers_manager.model_enabled")}</span>
                                  <Switch checked={model.is_active} onCheckedChange={(checked) => handleToggleModel(provider, model, checked)} />
                                </div>
                                <Button variant="outline" size="sm" onClick={() => openEditModel(provider, model)}>
                                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                  {t("providers_manager.edit_model")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteModel(provider, model)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("providers_manager.global_sampling_title")}</CardTitle>
          <CardDescription>{t("providers_manager.global_sampling_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {[
              { title: "Chat", icon: MessageSquare, color: "text-sky-500", form: chatSampling, setter: setChatSampling },
              { title: "Translate", icon: Languages, color: "text-amber-500", form: translateSampling, setter: setTranslateSampling },
            ].map((section) => {
              const Icon = section.icon
              return (
                <div key={section.title} className="rounded-xl border p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${section.color}`} />
                    <p className="font-medium">{section.title}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {SAMPLING_FIELDS.map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label>{field.label}</Label>
                        <Input
                          placeholder={t("providers_manager.default_placeholder")}
                          value={section.form[field.key]}
                          onChange={(event) =>
                            section.setter((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => saveGlobalMutation.mutate()} disabled={saveGlobalMutation.isPending}>
              {saveGlobalMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tc("btn.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingChannel ? t("providers_manager.dialogs.channel_title_edit") : t("providers_manager.dialogs.channel_title_new")}</DialogTitle>
            <DialogDescription>{t("providers_manager.dialogs.channel_description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.channel_name")}</Label>
              <Input value={channelForm.name} onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input value={channelForm.baseUrl} onChange={(event) => setChannelForm((current) => ({ ...current, baseUrl: event.target.value }))} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>API Key</Label>
              <Input type="password" value={channelForm.apiKey} onChange={(event) => setChannelForm((current) => ({ ...current, apiKey: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.priority")}</Label>
              <Input type="number" value={channelForm.priority ?? 0} onChange={(event) => setChannelForm((current) => ({ ...current, priority: Number(event.target.value || "0") }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.retry_count")}</Label>
              <Input type="number" value={channelForm.maxRetries ?? 3} onChange={(event) => setChannelForm((current) => ({ ...current, maxRetries: Number(event.target.value || "0") }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.concurrency")}</Label>
              <Input type="number" value={channelForm.concurrency ?? 3} onChange={(event) => setChannelForm((current) => ({ ...current, concurrency: Number(event.target.value || "1") }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.timeout")}</Label>
              <Input type="number" value={channelForm.timeout ?? ""} onChange={(event) => setChannelForm((current) => ({ ...current, timeout: event.target.value.trim() ? Number(event.target.value) : undefined }))} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="font-medium text-sm">{t("providers_manager.dialogs.enable_channel_title")}</p>
              <p className="text-xs text-muted-foreground">{t("providers_manager.dialogs.enable_channel_description")}</p>
            </div>
            <Switch checked={channelForm.isActive ?? true} onCheckedChange={(checked) => setChannelForm((current) => ({ ...current, isActive: checked }))} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChannelDialogOpen(false)}>{tc("btn.cancel")}</Button>
            <Button onClick={handleSaveChannel} disabled={saveChannelMutation.isPending}>
              {saveChannelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("providers_manager.dialogs.save_channel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingModel ? t("providers_manager.dialogs.model_title_edit") : t("providers_manager.dialogs.model_title_new")}</DialogTitle>
            <DialogDescription>{t("providers_manager.dialogs.model_description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.display_name")}</Label>
              <Input value={modelForm.name ?? ""} onChange={(event) => setModelForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.model_type")}</Label>
              <Select value={modelForm.modelType} onValueChange={(value) => setModelForm((current) => ({ ...current, modelType: value as ProviderModelType, supportsVision: value === "chat" || value === "translate" ? (current.supportsVision ?? false) : false }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{t("providers_manager.dialogs.model_identifier")}</Label>
              <Input value={modelForm.modelName ?? ""} onChange={(event) => setModelForm((current) => ({ ...current, modelName: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("providers_manager.dialogs.priority")}</Label>
              <Input type="number" value={modelForm.priority ?? 0} onChange={(event) => setModelForm((current) => ({ ...current, priority: Number(event.target.value || "0") }))} />
            </div>
          </div>
          {(modelForm.modelType === "chat" || modelForm.modelType === "translate") && (
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div className="flex items-start gap-3">
                <Eye className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{t("providers_manager.dialogs.vision_title")}</p>
                  <p className="text-xs text-muted-foreground">{t("providers_manager.dialogs.vision_description")}</p>
                </div>
              </div>
              <Switch checked={modelForm.supportsVision ?? false} onCheckedChange={(checked) => setModelForm((current) => ({ ...current, supportsVision: checked }))} />
            </div>
          )}
          {modelForm.modelType === "embed" && (
            <div className="space-y-1.5 rounded-lg border px-4 py-3">
              <Label>{t("providers_manager.dialogs.embedding_dimensions")}</Label>
              <Input type="number" value={modelForm.config?.dimensions ?? ""} onChange={(event) => setModelForm((current) => ({ ...current, config: { ...current.config, dimensions: event.target.value.trim() ? Number(event.target.value) : undefined } }))} />
            </div>
          )}
          {modelForm.modelType === "rerank" && (
            <div className="space-y-1.5 rounded-lg border px-4 py-3">
              <Label>{t("providers_manager.dialogs.rerank_top_n")}</Label>
              <Input type="number" value={modelForm.config?.rerank_top_n ?? ""} onChange={(event) => setModelForm((current) => ({ ...current, config: { ...current.config, rerank_top_n: event.target.value.trim() ? Number(event.target.value) : undefined } }))} />
            </div>
          )}
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="font-medium text-sm">{t("providers_manager.dialogs.enable_model_title")}</p>
              <p className="text-xs text-muted-foreground">{t("providers_manager.dialogs.enable_model_description")}</p>
            </div>
            <Switch checked={modelForm.isActive ?? true} onCheckedChange={(checked) => setModelForm((current) => ({ ...current, isActive: checked }))} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModelDialogOpen(false)}>{tc("btn.cancel")}</Button>
            <Button onClick={handleSaveModel} disabled={saveModelMutation.isPending}>
              {saveModelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("providers_manager.dialogs.save_model")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
