import { useState, useCallback, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, channelStore, type ChannelConfig, type TranslatePromptConfig, DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from "@/lib/api"
import {
  loadWebDAVConfig, saveWebDAVConfig, isWebDAVConfigured,
  loadLastSyncInfo, saveLastSyncInfo, loadSyncDefaults, saveSyncDefaults,
  exportBackup, readBackupFile, validateBackupFile, importBackup,
  syncWebDAV,
  type WebDAVConfig, type SyncScope, type SyncMode, type LastSyncInfo, type BackupSummary,
} from "@/lib/sync-backup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Plus, Trash2, GripVertical, Eye, ChevronDown, ChevronUp, RotateCcw, ArrowDownUp, MessageSquare, Layers, Languages, ListRestart, RotateCw, Loader2, Play, Square, Circle, Download, Upload, RefreshCw, Save, EyeOff, CheckCircle, XCircle, Clock, FileUp, FileDown } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"

// --- Channel Section Component ---

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const emptyChannel = (): Omit<ChannelConfig, "id"> => ({
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  supportsVision: false,
  maxRetries: 3,
  isActive: true,
})

interface ChannelSectionProps {
  title: string
  description: string
  icon: React.ReactNode
  channels: ChannelConfig[]
  onChange: (channels: ChannelConfig[]) => void
  channelType: "chat" | "translate" | "embed" | "rerank"
}

function ChannelSection({ title, description, icon, channels, onChange, channelType }: ChannelSectionProps) {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyChannel())
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleAdd = () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.model) {
      toast({
        title: t("channel.toast.required.title"),
        description: t("channel.toast.required.description"),
        variant: "destructive",
      })
      return
    }
    const newChannel: ChannelConfig = { ...form, id: genId() }
    onChange([...channels, newChannel])
    setForm(emptyChannel())
    setShowForm(false)
    toast({ title: t("channel.toast.added.title"), description: t("channel.toast.added.description", { name: newChannel.name }) })
  }

  const handleDelete = (id: string) => {
    const ch = channels.find((c) => c.id === id)
    onChange(channels.filter((c) => c.id !== id))
    toast({ title: t("channel.toast.deleted.title"), description: t("channel.toast.deleted.description", { name: ch?.name || "" }) })
  }

  const handleToggleVision = (id: string) => {
    onChange(channels.map((c) => (c.id === id ? { ...c, supportsVision: !c.supportsVision } : c)))
  }

  const handleToggleActive = (id: string) => {
    onChange(channels.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c)))
  }

  const handleRetryChange = (id: string, value: number) => {
    onChange(channels.map((c) => (c.id === id ? { ...c, maxRetries: value } : c)))
  }

  // Drag and drop
  const handleDragStart = (index: number) => {
    dragItem.current = index
  }

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return
    if (dragItem.current === dragOverItem.current) {
      dragItem.current = null
      dragOverItem.current = null
      setDragOverIndex(null)
      return
    }
    const items = [...channels]
    const [dragged] = items.splice(dragItem.current, 1)
    items.splice(dragOverItem.current, 0, dragged)
    onChange(items)
    dragItem.current = null
    dragOverItem.current = null
    setDragOverIndex(null)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const moveItem = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1
    if (target < 0 || target >= channels.length) return
    const items = [...channels]
    ;[items[index], items[target]] = [items[target], items[index]]
    onChange(items)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Button
            size="sm"
            variant={showForm ? "secondary" : "default"}
            onClick={() => {
              setShowForm(!showForm)
              setForm(emptyChannel())
            }}
          >
            {showForm ? (
              <>{t("channel.collapse")}</>
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                {t("channel.add")}
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Add Form */}
        {showForm && (
          <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("channel.form.name")}</Label>
                <Input
                  placeholder={t("channel.form.name_placeholder")}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("channel.form.base_url")}</Label>
                <Input
                  placeholder="https://api.openai.com/v1"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("channel.form.api_key")}</Label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("channel.form.model")}</Label>
                <Input
                  placeholder={t(`channel.form.model_placeholder_${channelType}`)}
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              {(channelType === "chat" || channelType === "translate") && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.supportsVision}
                    onCheckedChange={(checked) => setForm({ ...form, supportsVision: checked })}
                  />
                  <Label className="flex items-center gap-1 cursor-pointer">
                    <Eye className="h-4 w-4" />
                    {t("channel.form.vision")}
                  </Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Label>{t("channel.form.retries")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  className="w-20"
                  value={form.maxRetries}
                  onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>
                <Plus className="mr-1 h-4 w-4" />
                {t("channel.confirm_add")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                {tc("btn.cancel")}
              </Button>
            </div>
          </div>
        )}

        {/* Channel List */}
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("channel.empty")}
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2 px-1">
              <ArrowDownUp className="h-3 w-3" />
              {t("channel.priority_hint")}
            </div>
            {channels.map((ch, index) => (
              <div
                key={ch.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                className={`flex items-center gap-3 border rounded-lg px-3 py-2.5 transition-all cursor-grab active:cursor-grabbing ${
                  dragOverIndex === index ? "border-primary bg-primary/5 scale-[1.01]" : ""
                } ${!ch.isActive ? "opacity-50" : ""}`}
              >
                {/* Drag Handle + Priority */}
                <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                  <GripVertical className="h-4 w-4" />
                  <span className="text-xs font-mono w-4 text-center">{index + 1}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{ch.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      {ch.model}
                    </Badge>
                    {ch.supportsVision && (channelType === "chat" || channelType === "translate") && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 hover:bg-violet-100 shrink-0">
                        <Eye className="h-3 w-3 mr-0.5" />
                        Vision
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{ch.baseUrl}</p>
                </div>

                {/* Retry */}
                <div className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground" title={t("channel.form.retries")}>
                  <RotateCcw className="h-3 w-3" />
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    className="w-14 h-7 text-xs text-center"
                    value={ch.maxRetries}
                    onChange={(e) => handleRetryChange(ch.id, parseInt(e.target.value) || 0)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                {/* Vision Toggle */}
                {(channelType === "chat" || channelType === "translate") && (
                  <div className="shrink-0" title={ch.supportsVision ? t("channel.vision_enabled") : t("channel.vision_disabled")}>
                    <Switch
                      checked={ch.supportsVision}
                      onCheckedChange={() => handleToggleVision(ch.id)}
                    />
                  </div>
                )}

                {/* Active Toggle */}
                <div className="shrink-0" title={ch.isActive ? t("channel.enabled") : t("channel.disabled")}>
                  <Switch
                    checked={ch.isActive}
                    onCheckedChange={() => handleToggleActive(ch.id)}
                  />
                </div>

                {/* Move Buttons */}
                <div className="flex flex-col shrink-0">
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => moveItem(index, "up")}
                    title={t("channel.move_up")}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={index === channels.length - 1}
                    onClick={() => moveItem(index, "down")}
                    title={t("channel.move_down")}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Delete */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(ch.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// --- Main Settings Page ---

export default function Settings() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const defaultMineruCloneUrl = "https://github.com/opendatalab/MinerU.git"
  const defaultMineruPipIndexUrl = "https://pypi.org/simple"

  // Channel state (localStorage-backed)
  const [chatChannels, setChatChannels] = useState<ChannelConfig[]>(() => channelStore.getChatChannels())
  const [translateChannels, setTranslateChannels] = useState<ChannelConfig[]>(() => channelStore.getTranslateChannels())
  const [embedChannels, setEmbedChannels] = useState<ChannelConfig[]>(() => channelStore.getEmbedChannels())
  const [rerankChannels, setRerankChannels] = useState<ChannelConfig[]>(() => channelStore.getRerankChannels())
  const [failoverEnabled, setFailoverEnabled] = useState(() => channelStore.getFailoverEnabled())

  // Persist on change
  const updateChatChannels = useCallback((channels: ChannelConfig[]) => {
    setChatChannels(channels)
    channelStore.saveChatChannels(channels)
  }, [])

  const updateTranslateChannels = useCallback((channels: ChannelConfig[]) => {
    setTranslateChannels(channels)
    channelStore.saveTranslateChannels(channels)
  }, [])

  const updateEmbedChannels = useCallback((channels: ChannelConfig[]) => {
    setEmbedChannels(channels)
    channelStore.saveEmbedChannels(channels)
  }, [])

  const updateRerankChannels = useCallback((channels: ChannelConfig[]) => {
    setRerankChannels(channels)
    channelStore.saveRerankChannels(channels)
  }, [])

  const toggleFailover = useCallback((enabled: boolean) => {
    setFailoverEnabled(enabled)
    channelStore.setFailoverEnabled(enabled)
  }, [])

  // Translation prompt state
  const [translatePrompt, setTranslatePrompt] = useState<TranslatePromptConfig>(
    () => channelStore.getTranslatePrompt()
  )

  const updateTranslatePrompt = useCallback((updates: Partial<TranslatePromptConfig>) => {
    setTranslatePrompt((prev) => {
      const next = { ...prev, ...updates }
      channelStore.saveTranslatePrompt(next)
      return next
    })
  }, [])

  const resetTranslatePrompt = useCallback(() => {
    const defaults = { systemPrompt: DEFAULT_SYSTEM_PROMPT, userPrompt: DEFAULT_USER_PROMPT }
    setTranslatePrompt(defaults)
    channelStore.saveTranslatePrompt(defaults)
    toast({ title: t("prompt.toast.reset") })
  }, [t, toast])

  // MinerU state (DB-backed via app_settings)
  const queryClient = useQueryClient()
  const defaultPythonPath = navigator.platform.startsWith("Win") ? "python" : "python3"
  const [mineruMode, setMineruMode] = useState("builtin")
  const [mineruPythonPath, setMineruPythonPath] = useState(defaultPythonPath)
  const [mineruPort, setMineruPort] = useState("8765")
  const [mineruAutoStart, setMineruAutoStart] = useState(false)
  const [mineruExternalUrl, setMineruExternalUrl] = useState("http://localhost:8000")
  const [mineruSettingsLoaded, setMineruSettingsLoaded] = useState(false)
  const [mineruUseVenv, setMineruUseVenv] = useState(false)
  const [mineruCloneUrl, setMineruCloneUrl] = useState(defaultMineruCloneUrl)
  const [mineruPipIndexUrl, setMineruPipIndexUrl] = useState(defaultMineruPipIndexUrl)
  const [mineruInstallMethod, setMineruInstallMethod] = useState("pip")
  const [mineruModelSource, setMineruModelSource] = useState("huggingface")
  const [mineruModelsDir, setMineruModelsDir] = useState("")
  const [ragSettingsLoaded, setRagSettingsLoaded] = useState(false)
  const [ragChunkSize, setRagChunkSize] = useState("512")
  const [ragChunkOverlap, setRagChunkOverlap] = useState("50")
  const [ragVectorBackend, setRagVectorBackend] = useState("sqlite")
  const [zvecPythonPath, setZvecPythonPath] = useState(defaultPythonPath)
  const [zvecCollectionsDir, setZvecCollectionsDir] = useState("")

  // Load MinerU settings from DB
  const { data: appSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: api.getAllAppSettings,
  })

  useEffect(() => {
    if (appSettings && !mineruSettingsLoaded) {
      const settingsMap = new Map(appSettings.map((s) => [s.key, s.value]))
      setMineruMode(settingsMap.get("mineru.mode") || "builtin")
      setMineruPythonPath(settingsMap.get("mineru.python_path") || defaultPythonPath)
      setMineruPort(settingsMap.get("mineru.port") || "8765")
      setMineruAutoStart(settingsMap.get("mineru.auto_start") === "true")
      setMineruExternalUrl(settingsMap.get("mineru.external_url") || "http://localhost:8000")
      setMineruUseVenv(settingsMap.get("mineru.use_venv") === "true")
      setMineruCloneUrl(settingsMap.get("mineru.clone_url") || defaultMineruCloneUrl)
      setMineruPipIndexUrl(settingsMap.get("mineru.pip_index_url") || defaultMineruPipIndexUrl)
      setMineruInstallMethod(settingsMap.get("mineru.install_method") || "pip")
      setMineruModelSource(settingsMap.get("mineru.model_source") || "huggingface")
      setMineruModelsDir(settingsMap.get("mineru.models_dir") || "")
      setMineruSettingsLoaded(true)
    }
  }, [appSettings, defaultMineruCloneUrl, defaultMineruPipIndexUrl, mineruSettingsLoaded])

  useEffect(() => {
    if (appSettings && !ragSettingsLoaded) {
      const settingsMap = new Map(appSettings.map((s) => [s.key, s.value]))
      setRagChunkSize(settingsMap.get("rag.chunk_size") || "512")
      setRagChunkOverlap(settingsMap.get("rag.chunk_overlap") || "50")
      setRagVectorBackend(settingsMap.get("rag.vector_backend") || "sqlite")
      setZvecPythonPath(settingsMap.get("rag.zvec_python_path") || defaultPythonPath)
      setZvecCollectionsDir(settingsMap.get("rag.zvec_collections_dir") || "")
      setRagSettingsLoaded(true)
    }
  }, [appSettings, defaultPythonPath, ragSettingsLoaded])

  // Poll MinerU status
  const { data: mineruStatus } = useQuery({
    queryKey: ["mineruStatus"],
    queryFn: api.getMinerUStatus,
    refetchInterval: mineruMode === "builtin" ? 3000 : false,
  })

  // Check venv existence on mount
  const { data: venvExists } = useQuery({
    queryKey: ["venvExists"],
    queryFn: api.checkVenvExists,
    enabled: mineruMode === "builtin",
  })

  // Poll venv status during setup
  const { data: venvStatusData } = useQuery({
    queryKey: ["venvStatus"],
    queryFn: api.getVenvStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "creating" ? 2000 : false
    },
    enabled: mineruMode === "builtin",
  })

  // Poll model download status
  const { data: modelDownloadStatusData } = useQuery({
    queryKey: ["modelDownloadStatus"],
    queryFn: api.getModelDownloadStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "downloading" ? 1000 : false
    },
    enabled: mineruMode === "builtin",
  })

  const { data: zvecStatus } = useQuery({
    queryKey: ["zvecStatus"],
    queryFn: api.getZvecStatus,
    enabled: ragSettingsLoaded,
  })

  // Save MinerU settings mutation
  const saveMineruSettingsMutation = useMutation({
    mutationFn: async () => {
      await api.setAppSetting("mineru.mode", mineruMode)
      await api.setAppSetting("mineru.python_path", mineruPythonPath)
      await api.setAppSetting("mineru.port", mineruPort)
      await api.setAppSetting("mineru.auto_start", mineruAutoStart ? "true" : "false")
      await api.setAppSetting("mineru.external_url", mineruExternalUrl)
      await api.setAppSetting("mineru.use_venv", mineruUseVenv ? "true" : "false")
      await api.setAppSetting("mineru.clone_url", mineruCloneUrl.trim() || defaultMineruCloneUrl)
      await api.setAppSetting("mineru.pip_index_url", mineruPipIndexUrl.trim() || defaultMineruPipIndexUrl)
      await api.setAppSetting("mineru.install_method", mineruInstallMethod)
      await api.setAppSetting("mineru.model_source", mineruModelSource)
      await api.setAppSetting("mineru.models_dir", mineruModelsDir.trim())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] })
      queryClient.invalidateQueries({ queryKey: ["modelDownloadStatus"] })
      toast({ title: t("mineru.toast.saved") })
    },
    onError: (error: any) => {
      toast({ title: t("mineru.toast.error.title"), description: error.message, variant: "destructive" })
    },
  })

  const saveRagSettingsMutation = useMutation({
    mutationFn: async () => {
      await api.setAppSetting("rag.chunk_size", ragChunkSize.trim() || "512")
      await api.setAppSetting("rag.chunk_overlap", ragChunkOverlap.trim() || "50")
      await api.setAppSetting("rag.vector_backend", ragVectorBackend)
      await api.setAppSetting("rag.zvec_python_path", zvecPythonPath.trim() || defaultPythonPath)
      await api.setAppSetting("rag.zvec_collections_dir", zvecCollectionsDir.trim())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] })
      queryClient.invalidateQueries({ queryKey: ["zvecStatus"] })
      toast({ title: t("rag.toast.saved") })
    },
    onError: (error: any) => {
      toast({
        title: t("rag.toast.save_error"),
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // Start/Stop MinerU mutations
  const startMineruMutation = useMutation({
    mutationFn: api.startMinerU,
    onSuccess: (msg) => {
      queryClient.invalidateQueries({ queryKey: ["mineruStatus"] })
      const portMatch = msg.match(/port (\d+)/)
      toast({ title: t("mineru.toast.start_success", { port: portMatch?.[1] || "" }) })
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ["mineruStatus"] })
      toast({ title: t("mineru.toast.start_error"), description: error.message, variant: "destructive" })
    },
  })

  const stopMineruMutation = useMutation({
    mutationFn: api.stopMinerU,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mineruStatus"] })
      toast({ title: t("mineru.toast.stop_success") })
    },
    onError: (error: any) => {
      toast({ title: t("mineru.toast.error.title"), description: error.message, variant: "destructive" })
    },
  })

  const handleStartMineru = async () => {
    // Save settings first, then start
    await saveMineruSettingsMutation.mutateAsync()
    startMineruMutation.mutate()
  }

  // Venv setup mutation
  const setupVenvMutation = useMutation({
    mutationFn: api.setupMineruVenv,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["venvStatus"] })
      toast({ title: t("mineru.venv.toast.started") })
    },
    onError: (error: any) => {
      toast({ title: t("mineru.venv.toast.error_title"), description: error.message, variant: "destructive" })
    },
  })

  const handleSetupVenv = async () => {
    // Save python path first so backend knows which system python to use
    await saveMineruSettingsMutation.mutateAsync()
    setupVenvMutation.mutate()
  }

  // Model download mutation
  const downloadModelsMutation = useMutation({
    mutationFn: api.downloadMineruModels,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modelDownloadStatus"] })
      toast({ title: t("mineru.models.toast.started") })
    },
    onError: (error: any) => {
      toast({ title: t("mineru.models.toast.error_title"), description: error.message, variant: "destructive" })
    },
  })

  const handleDownloadModels = async () => {
    await saveMineruSettingsMutation.mutateAsync()
    downloadModelsMutation.mutate()
  }

  const venvStatus = venvStatusData?.status || (venvExists ? "ready" : "not_created")

  // WebDAV & Sync state
  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>(() => loadWebDAVConfig())
  const [showPassword, setShowPassword] = useState(false)
  const [syncMode, setSyncMode] = useState<SyncMode>(() => loadSyncDefaults().mode)
  const [syncScope, setSyncScope] = useState<SyncScope>(() => loadSyncDefaults().scope)
  const [lastSync, setLastSync] = useState<LastSyncInfo | null>(() => loadLastSyncInfo())
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: "", message: "", onConfirm: () => {} })
  const [importSummary, setImportSummary] = useState<BackupSummary | null>(null)
  const [importJson, setImportJson] = useState<string>("")
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const testMineruMutation = useMutation({
    mutationFn: api.testMinerUConnection,
    onSuccess: (data) => {
      toast({ title: t("mineru.toast.success"), description: data })
    },
    onError: (error: any) => {
      toast({
        title: t("mineru.toast.error.title"),
        description: error.message || t("mineru.toast.error.description"),
        variant: "destructive",
      })
    },
  })

  const testWebdavMutation = useMutation({
    mutationFn: api.testWebdavConnection,
    onSuccess: (data) => {
      toast({ title: t("webdav.toast.success"), description: data })
    },
    onError: (error: any) => {
      toast({
        title: t("webdav.toast.error.title"),
        description: error.message || t("webdav.toast.error.description"),
        variant: "destructive",
      })
    },
  })

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const config = loadWebDAVConfig()
      await syncWebDAV(config, syncMode, syncScope)
    },
    onSuccess: () => {
      const info: LastSyncInfo = {
        time: new Date().toISOString(),
        mode: syncMode,
        scope: syncScope,
        result: "success",
      }
      saveLastSyncInfo(info)
      setLastSync(info)
      queryClient.invalidateQueries()
      toast({ title: t("webdav.sync_success") })
    },
    onError: (error: any) => {
      const info: LastSyncInfo = {
        time: new Date().toISOString(),
        mode: syncMode,
        scope: syncScope,
        result: "error",
        message: error.message,
      }
      saveLastSyncInfo(info)
      setLastSync(info)
      toast({ title: t("webdav.sync_error"), description: error.message, variant: "destructive" })
    },
  })

  // Export mutations
  const exportFullMutation = useMutation({
    mutationFn: () => exportBackup("full"),
    onSuccess: () => toast({ title: t("webdav.export_success") }),
    onError: (error: any) => toast({ title: t("webdav.export_error"), description: error.message, variant: "destructive" }),
  })

  const exportConfigMutation = useMutation({
    mutationFn: () => exportBackup("config"),
    onSuccess: () => toast({ title: t("webdav.export_success") }),
    onError: (error: any) => toast({ title: t("webdav.export_error"), description: error.message, variant: "destructive" }),
  })

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      await importBackup(importJson)
    },
    onSuccess: () => {
      setImportJson("")
      setImportSummary(null)
      queryClient.invalidateQueries()
      toast({ title: t("webdav.import_success") })
    },
    onError: (error: any) => {
      toast({ title: t("webdav.import_error"), description: error.message, variant: "destructive" })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
          <TabsTrigger value="translation">{t("tabs.translation")}</TabsTrigger>
          <TabsTrigger value="providers">{t("tabs.providers")}</TabsTrigger>
          <TabsTrigger value="mineru">{t("tabs.mineru")}</TabsTrigger>
          <TabsTrigger value="webdav">{t("tabs.webdav")}</TabsTrigger>
          <TabsTrigger value="rag">{t("tabs.rag")}</TabsTrigger>
        </TabsList>

        {/* ---- General ---- */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>{t("general.title")}</CardTitle>
              <CardDescription>{t("general.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("general.language")}</Label>
                <p className="text-xs text-muted-foreground">{t("general.language_desc")}</p>
                <LanguageSwitcher />
              </div>
              <div className="space-y-2">
                <Label>{t("general.default_target_language")}</Label>
                <Input placeholder="English" />
              </div>
              <div className="space-y-2">
                <Label>{t("general.theme")}</Label>
                <select className="w-full h-10 px-3 rounded-md border border-input bg-background">
                  <option>{t("general.theme_options.light")}</option>
                  <option>{t("general.theme_options.dark")}</option>
                  <option>{t("general.theme_options.system")}</option>
                </select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Translation Prompt ---- */}
        <TabsContent value="translation">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("prompt.title")}</CardTitle>
                    <CardDescription>{t("prompt.description")}</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetTranslatePrompt}
                  >
                    <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                    {t("prompt.reset")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>{t("prompt.system_prompt")}</Label>
                  <p className="text-xs text-muted-foreground">{t("prompt.system_prompt_desc")}</p>
                  <textarea
                    value={translatePrompt.systemPrompt}
                    onChange={(e) => updateTranslatePrompt({ systemPrompt: e.target.value })}
                    rows={5}
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[100px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("prompt.user_prompt")}</Label>
                  <p className="text-xs text-muted-foreground">{t("prompt.user_prompt_desc")}</p>
                  <textarea
                    value={translatePrompt.userPrompt}
                    onChange={(e) => updateTranslatePrompt({ userPrompt: e.target.value })}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Variable reference */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("prompt.variables.title")}</CardTitle>
                <CardDescription>{t("prompt.variables.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium">{t("prompt.variables.col_variable")}</th>
                        <th className="text-left px-4 py-2 font-medium">{t("prompt.variables.col_description")}</th>
                        <th className="text-left px-4 py-2 font-medium">{t("prompt.variables.col_example")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="px-4 py-2 font-mono text-xs text-primary">{"{{source_lang}}"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{t("prompt.variables.source_lang")}</td>
                        <td className="px-4 py-2 text-muted-foreground">English</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 font-mono text-xs text-primary">{"{{target_lang}}"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{t("prompt.variables.target_lang")}</td>
                        <td className="px-4 py-2 text-muted-foreground">中文</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 font-mono text-xs text-primary">{"{{text}}"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{t("prompt.variables.text")}</td>
                        <td className="px-4 py-2 text-muted-foreground">Hello world</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 font-mono text-xs text-primary">{"{{filename}}"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{t("prompt.variables.filename")}</td>
                        <td className="px-4 py-2 text-muted-foreground">report.pdf</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2 font-mono text-xs text-primary">{"{{chunk_index}}"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{t("prompt.variables.chunk_index")}</td>
                        <td className="px-4 py-2 text-muted-foreground">3</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- LLM Providers ---- */}
        <TabsContent value="providers">
          <div className="space-y-4">
            {/* Global Failover Settings */}
            <Card>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium text-sm">{t("providers.failover.label")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("providers.failover.description")}
                  </p>
                </div>
                <Switch checked={failoverEnabled} onCheckedChange={toggleFailover} />
              </CardContent>
            </Card>

            {/* Chat Channels */}
            <ChannelSection
              title={t("providers.chat.title")}
              description={t("providers.chat.description")}
              icon={<MessageSquare className="h-5 w-5 text-blue-500" />}
              channels={chatChannels}
              onChange={updateChatChannels}
              channelType="chat"
            />

            {/* Translate Channels */}
            <ChannelSection
              title={t("providers.translate.title")}
              description={t("providers.translate.description")}
              icon={<Languages className="h-5 w-5 text-amber-500" />}
              channels={translateChannels}
              onChange={updateTranslateChannels}
              channelType="translate"
            />

            {/* Embedding Channels */}
            <ChannelSection
              title={t("providers.embed.title")}
              description={t("providers.embed.description")}
              icon={<Layers className="h-5 w-5 text-emerald-500" />}
              channels={embedChannels}
              onChange={updateEmbedChannels}
              channelType="embed"
            />

            {/* Rerank Channels */}
            <ChannelSection
              title={t("providers.rerank.title")}
              description={t("providers.rerank.description")}
              icon={<ListRestart className="h-5 w-5 text-purple-500" />}
              channels={rerankChannels}
              onChange={updateRerankChannels}
              channelType="rerank"
            />
          </div>
        </TabsContent>

        {/* ---- PDF Parsing ---- */}
        <TabsContent value="mineru">
          <Card>
            <CardHeader>
              <CardTitle>{t("mineru.title")}</CardTitle>
              <CardDescription>{t("mineru.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Mode selector */}
              <div className="space-y-3">
                <Label>{t("mineru.mode_label")}</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="mineruMode"
                      value="builtin"
                      checked={mineruMode === "builtin"}
                      onChange={() => setMineruMode("builtin")}
                      className="accent-primary"
                    />
                    <span className="text-sm">{t("mineru.mode_builtin")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="mineruMode"
                      value="external"
                      checked={mineruMode === "external"}
                      onChange={() => setMineruMode("external")}
                      className="accent-primary"
                    />
                    <span className="text-sm">{t("mineru.mode_external")}</span>
                  </label>
                </div>
              </div>

              {mineruMode === "builtin" && (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <div>
                    <p className="font-medium text-sm">{t("mineru.builtin.title")}</p>
                    <p className="text-xs text-muted-foreground">{t("mineru.builtin.description")}</p>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-2">
                    <Label>{t("mineru.builtin.status_label")}</Label>
                    {mineruStatus?.status === "running" ? (
                      <Badge variant="default" className="gap-1">
                        <Circle className="h-2 w-2 fill-current" />
                        {t("mineru.builtin.status_running", { port: mineruStatus.port })}
                      </Badge>
                    ) : mineruStatus?.status === "starting" ? (
                      <Badge variant="secondary" className="gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("mineru.builtin.status_starting")}
                      </Badge>
                    ) : mineruStatus?.status === "failed" ? (
                      <Badge variant="destructive" className="gap-1">
                        {t("mineru.builtin.status_failed", { error: mineruStatus.error || "" })}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        {t("mineru.builtin.status_stopped")}
                      </Badge>
                    )}
                  </div>

                  {/* Python path */}
                  <div className="space-y-2">
                    <Label>{t("mineru.builtin.python_path_label")}</Label>
                    <Input
                      placeholder={t("mineru.builtin.python_path_placeholder")}
                      value={mineruPythonPath}
                      onChange={(e) => setMineruPythonPath(e.target.value)}
                      disabled={mineruUseVenv && venvStatus === "ready"}
                    />
                    {mineruUseVenv && venvStatus === "ready" && (
                      <p className="text-xs text-muted-foreground">{t("mineru.venv.using_venv_hint")}</p>
                    )}
                  </div>

                  {/* Port */}
                  <div className="space-y-2">
                    <Label>{t("mineru.builtin.port_label")}</Label>
                    <Input
                      type="number"
                      value={mineruPort}
                      onChange={(e) => setMineruPort(e.target.value)}
                      className="w-32"
                    />
                  </div>

                  {/* Python Environment Setup */}
                  <div className="space-y-3 border rounded-lg p-4 bg-background/50">
                    <div>
                      <p className="font-medium text-sm">{t("mineru.venv.title")}</p>
                      <p className="text-xs text-muted-foreground">{t("mineru.venv.description")}</p>
                    </div>

                    {/* Venv status badge */}
                    <div className="flex items-center gap-2">
                      <Label>{t("mineru.builtin.status_label")}</Label>
                      {venvStatus === "ready" ? (
                        <Badge variant="default">{t("mineru.venv.status_ready")}</Badge>
                      ) : venvStatus === "creating" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("mineru.venv.status_creating")}
                        </Badge>
                      ) : venvStatus === "failed" ? (
                        <Badge variant="destructive">{t("mineru.venv.status_failed")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("mineru.venv.status_not_created")}</Badge>
                      )}
                    </div>

                    {/* Progress / error message */}
                    {venvStatus === "creating" && venvStatusData?.message && (
                      <p className="text-xs text-muted-foreground">{venvStatusData.message}</p>
                    )}
                    {venvStatus === "failed" && venvStatusData?.message && (
                      <p className="text-xs text-destructive font-mono break-all">{venvStatusData.message}</p>
                    )}

                    {/* Use venv toggle */}
                    {venvStatus === "ready" && (
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{t("mineru.venv.use_venv_label")}</p>
                        <Switch
                          checked={mineruUseVenv}
                          onCheckedChange={setMineruUseVenv}
                        />
                      </div>
                    )}

                    {/* Installation Method */}
                    <div className="space-y-2">
                      <Label>{t("mineru.venv.install_method_label")}</Label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="installMethod"
                            value="pip"
                            checked={mineruInstallMethod === "pip"}
                            onChange={() => setMineruInstallMethod("pip")}
                            disabled={venvStatus === "creating"}
                            className="accent-primary"
                          />
                          <span className="text-sm">{t("mineru.venv.install_method_pip")}</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="installMethod"
                            value="git"
                            checked={mineruInstallMethod === "git"}
                            onChange={() => setMineruInstallMethod("git")}
                            disabled={venvStatus === "creating"}
                            className="accent-primary"
                          />
                          <span className="text-sm">{t("mineru.venv.install_method_git")}</span>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("mineru.venv.install_method_hint")}</p>
                    </div>

                    {/* Clone URL (only for git method) */}
                    {mineruInstallMethod === "git" && (
                    <div className="space-y-2">
                      <Label>{t("mineru.venv.clone_url_label")}</Label>
                      <Input
                        placeholder="https://github.com/opendatalab/MinerU.git"
                        value={mineruCloneUrl}
                        onChange={(e) => setMineruCloneUrl(e.target.value)}
                        disabled={venvStatus === "creating"}
                      />
                      <p className="text-xs text-muted-foreground">{t("mineru.venv.clone_url_hint")}</p>
                    </div>
                    )}

                    <div className="space-y-2">
                      <Label>{t("mineru.venv.pip_index_url_label")}</Label>
                      <Input
                        placeholder="https://pypi.org/simple"
                        value={mineruPipIndexUrl}
                        onChange={(e) => setMineruPipIndexUrl(e.target.value)}
                        disabled={venvStatus === "creating"}
                      />
                      <p className="text-xs text-muted-foreground">{t("mineru.venv.pip_index_url_hint")}</p>
                    </div>

                    {/* Setup button */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={venvStatus === "creating" || setupVenvMutation.isPending}
                      onClick={handleSetupVenv}
                    >
                      {venvStatus === "creating" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      {venvStatus === "ready" ? t("mineru.venv.btn_reinstall") : t("mineru.venv.btn_setup")}
                    </Button>
                  </div>

                  {/* Model Files */}
                  <div className="space-y-3 border rounded-lg p-4 bg-background/50">
                    <div>
                      <p className="font-medium text-sm">{t("mineru.models.title")}</p>
                      <p className="text-xs text-muted-foreground">{t("mineru.models.description")}</p>
                    </div>

                    <div className="space-y-2">
                      <Label>{t("mineru.models.source_label")}</Label>
                      <select
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={mineruModelSource}
                        onChange={(e) => setMineruModelSource(e.target.value)}
                      >
                        <option value="huggingface">{t("mineru.models.source_huggingface")}</option>
                        <option value="modelscope">{t("mineru.models.source_modelscope")}</option>
                        <option value="local">{t("mineru.models.source_local")}</option>
                      </select>
                      <p className="text-xs text-muted-foreground">{t("mineru.models.source_hint")}</p>
                    </div>

                    {mineruModelSource === "local" && (
                      <div className="space-y-2">
                        <Label>{t("mineru.models.dir_label")}</Label>
                        <Input
                          placeholder={t("mineru.models.dir_hint")}
                          value={mineruModelsDir}
                          onChange={(e) => setMineruModelsDir(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">{t("mineru.models.dir_hint")}</p>
                      </div>
                    )}

                    {/* Download status */}
                    <div className="flex items-center gap-2">
                      <Label>{t("mineru.builtin.status_label")}</Label>
                      {modelDownloadStatusData?.status === "completed" ? (
                        <Badge variant="default">{t("mineru.models.status_completed")}</Badge>
                      ) : modelDownloadStatusData?.status === "downloading" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("mineru.models.status_downloading")}
                          {(modelDownloadStatusData.progress ?? 0) > 0 && (
                            <span className="ml-1">{Math.round(modelDownloadStatusData.progress)}%</span>
                          )}
                        </Badge>
                      ) : modelDownloadStatusData?.status === "failed" ? (
                        <Badge variant="destructive">{t("mineru.models.status_failed")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("mineru.models.status_idle")}</Badge>
                      )}
                    </div>

                    {modelDownloadStatusData?.status === "downloading" && (
                      <div className="space-y-1.5">
                        <Progress value={modelDownloadStatusData.progress ?? 0} />
                        {modelDownloadStatusData.message && (
                          <p className="text-xs text-muted-foreground truncate" title={modelDownloadStatusData.message}>
                            {modelDownloadStatusData.message}
                          </p>
                        )}
                      </div>
                    )}
                    {modelDownloadStatusData?.status === "completed" && modelDownloadStatusData.message && (
                      <p className="text-xs text-muted-foreground truncate" title={modelDownloadStatusData.message}>
                        {modelDownloadStatusData.message}
                      </p>
                    )}
                    {modelDownloadStatusData?.status === "failed" && modelDownloadStatusData.message && (
                      <p className="text-xs text-destructive font-mono break-all">{modelDownloadStatusData.message}</p>
                    )}

                    {mineruModelSource !== "local" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          venvStatus !== "ready" ||
                          modelDownloadStatusData?.status === "downloading" ||
                          downloadModelsMutation.isPending
                        }
                        onClick={handleDownloadModels}
                      >
                        {modelDownloadStatusData?.status === "downloading" ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        {modelDownloadStatusData?.status === "completed"
                          ? t("mineru.models.btn_redownload")
                          : t("mineru.models.btn_download")}
                      </Button>
                    )}
                  </div>

                  {/* Auto-start */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{t("mineru.builtin.auto_start_label")}</p>
                      <p className="text-xs text-muted-foreground">{t("mineru.builtin.auto_start_description")}</p>
                    </div>
                    <Switch
                      checked={mineruAutoStart}
                      onCheckedChange={setMineruAutoStart}
                    />
                  </div>

                  {/* Start/Stop buttons */}
                  <div className="flex gap-2">
                    <Button
                      onClick={handleStartMineru}
                      disabled={mineruStatus?.status === "running" || mineruStatus?.status === "starting" || startMineruMutation.isPending}
                    >
                      {startMineruMutation.isPending || mineruStatus?.status === "starting" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      {t("mineru.builtin.btn_start")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => stopMineruMutation.mutate()}
                      disabled={mineruStatus?.status !== "running" || stopMineruMutation.isPending}
                    >
                      <Square className="mr-2 h-4 w-4" />
                      {t("mineru.builtin.btn_stop")}
                    </Button>
                  </div>
                </div>
              )}

              {mineruMode === "external" && (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <div>
                    <p className="font-medium text-sm">{t("mineru.external.title")}</p>
                    <p className="text-xs text-muted-foreground">{t("mineru.external.description")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("mineru.url_label")}</Label>
                    <Input
                      placeholder="http://localhost:8000"
                      value={mineruExternalUrl}
                      onChange={(e) => setMineruExternalUrl(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => testMineruMutation.mutate(mineruExternalUrl)}
                    disabled={testMineruMutation.isPending}
                  >
                    {testMineruMutation.isPending ? tc("btn.testing") : tc("btn.test_connection")}
                  </Button>
                </div>
              )}

              {/* Save button */}
              <Button
                onClick={() => saveMineruSettingsMutation.mutate()}
                disabled={saveMineruSettingsMutation.isPending}
              >
                {saveMineruSettingsMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("mineru.btn_save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Sync & Backup ---- */}
        <TabsContent value="webdav">
          <div className="space-y-4">
            {/* A. WebDAV Configuration */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("webdav.section_webdav")}</CardTitle>
                    <CardDescription>{t("webdav.section_webdav_desc")}</CardDescription>
                  </div>
                  {isWebDAVConfigured() ? (
                    <Badge variant="default">{t("webdav.configured")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("webdav.not_configured")}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("webdav.url")}</Label>
                  <Input
                    placeholder={t("webdav.url_placeholder")}
                    value={webdavConfig.baseUrl}
                    onChange={(e) => setWebdavConfig({ ...webdavConfig, baseUrl: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("webdav.username")}</Label>
                    <Input
                      placeholder={t("webdav.username")}
                      value={webdavConfig.username}
                      onChange={(e) => setWebdavConfig({ ...webdavConfig, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("webdav.password")}</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={webdavConfig.password}
                        onChange={(e) => setWebdavConfig({ ...webdavConfig, password: e.target.value })}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        title={showPassword ? t("webdav.hide_password") : t("webdav.show_password")}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("webdav.remote_path")}</Label>
                  <Input
                    placeholder="/pdf-translate"
                    value={webdavConfig.remotePath}
                    onChange={(e) => setWebdavConfig({ ...webdavConfig, remotePath: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!webdavConfig.baseUrl || !webdavConfig.username || !webdavConfig.password) {
                        toast({ title: t("webdav.fields_required"), variant: "destructive" })
                        return
                      }
                      if (!/^https?:\/\//i.test(webdavConfig.baseUrl)) {
                        toast({ title: t("webdav.url_invalid"), variant: "destructive" })
                        return
                      }
                      testWebdavMutation.mutate({
                        baseUrl: webdavConfig.baseUrl,
                        username: webdavConfig.username,
                        password: webdavConfig.password,
                      })
                    }}
                    disabled={testWebdavMutation.isPending}
                  >
                    {testWebdavMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    {testWebdavMutation.isPending ? tc("btn.testing") : t("webdav.btn_test")}
                  </Button>
                  <Button
                    onClick={() => {
                      if (!webdavConfig.baseUrl || !webdavConfig.username || !webdavConfig.password) {
                        toast({ title: t("webdav.fields_required"), variant: "destructive" })
                        return
                      }
                      if (!/^https?:\/\//i.test(webdavConfig.baseUrl)) {
                        toast({ title: t("webdav.url_invalid"), variant: "destructive" })
                        return
                      }
                      saveWebDAVConfig(webdavConfig)
                      toast({ title: t("webdav.config_saved") })
                    }}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {t("webdav.btn_save_config")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* B. Sync Behavior */}
            <Card>
              <CardHeader>
                <CardTitle>{t("webdav.section_sync")}</CardTitle>
                <CardDescription>{t("webdav.section_sync_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Sync Mode */}
                <div className="space-y-2">
                  <Label>{t("webdav.sync_mode")}</Label>
                  <div className="grid gap-2 md:grid-cols-3">
                    {(["auto", "upload", "download"] as SyncMode[]).map((mode) => (
                      <label
                        key={mode}
                        className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${syncMode === mode ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                      >
                        <input
                          type="radio"
                          name="syncMode"
                          value={mode}
                          checked={syncMode === mode}
                          onChange={() => { setSyncMode(mode); saveSyncDefaults(mode, syncScope) }}
                          className="accent-primary mt-0.5"
                        />
                        <div>
                          <p className="text-sm font-medium">{t(`webdav.sync_mode_${mode}` as any)}</p>
                          <p className="text-xs text-muted-foreground">{t(`webdav.sync_mode_${mode}_desc` as any)}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Sync Scope */}
                <div className="space-y-2">
                  <Label>{t("webdav.sync_scope")}</Label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(["full", "config"] as SyncScope[]).map((scope) => (
                      <label
                        key={scope}
                        className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${syncScope === scope ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                      >
                        <input
                          type="radio"
                          name="syncScope"
                          value={scope}
                          checked={syncScope === scope}
                          onChange={() => { setSyncScope(scope); saveSyncDefaults(syncMode, scope) }}
                          className="accent-primary mt-0.5"
                        />
                        <div>
                          <p className="text-sm font-medium">{t(`webdav.sync_scope_${scope}` as any)}</p>
                          <p className="text-xs text-muted-foreground">{t(`webdav.sync_scope_${scope}_desc` as any)}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Execute Sync */}
                <Button
                  disabled={syncMutation.isPending}
                  onClick={() => {
                    if (!isWebDAVConfigured()) {
                      toast({ title: t("webdav.webdav_not_configured"), variant: "destructive" })
                      return
                    }
                    const key = `sync_confirm_${syncMode}_${syncScope}` as const
                    setConfirmDialog({
                      open: true,
                      title: t("webdav.sync_confirm_title"),
                      message: t(`webdav.${key}` as any),
                      onConfirm: () => {
                        setConfirmDialog((prev) => ({ ...prev, open: false }))
                        syncMutation.mutate()
                      },
                    })
                  }}
                >
                  {syncMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : syncMode === "upload" ? (
                    <Upload className="mr-2 h-4 w-4" />
                  ) : syncMode === "download" ? (
                    <Download className="mr-2 h-4 w-4" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {t("webdav.btn_sync")}
                  <span className="ml-2 text-xs opacity-70">
                    ({t(`webdav.mode_${syncMode}` as any)} · {t(`webdav.scope_${syncScope}` as any)})
                  </span>
                </Button>

                {/* Last Sync Info */}
                {lastSync && (
                  <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      <Clock className="h-4 w-4" />
                      {t("webdav.last_sync")}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">{t("webdav.last_sync_time")}</span>
                      <span>{new Date(lastSync.time).toLocaleString()}</span>
                      <span className="text-muted-foreground">{t("webdav.last_sync_mode")}</span>
                      <span>{t(`webdav.mode_${lastSync.mode}` as any)}</span>
                      <span className="text-muted-foreground">{t("webdav.last_sync_scope")}</span>
                      <span>{t(`webdav.scope_${lastSync.scope}` as any)}</span>
                      <span className="text-muted-foreground">{t("webdav.last_sync_result")}</span>
                      <span className="flex items-center gap-1">
                        {lastSync.result === "success" ? (
                          <><CheckCircle className="h-3 w-3 text-green-500" />{t("webdav.last_sync_success")}</>
                        ) : (
                          <><XCircle className="h-3 w-3 text-destructive" />{t("webdav.last_sync_error")}</>
                        )}
                      </span>
                    </div>
                    {lastSync.message && (
                      <p className="text-xs text-destructive break-all">{lastSync.message}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* C. Local Backup */}
            <Card>
              <CardHeader>
                <CardTitle>{t("webdav.section_backup")}</CardTitle>
                <CardDescription>{t("webdav.section_backup_desc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Export */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    disabled={exportFullMutation.isPending || exportConfigMutation.isPending}
                    onClick={() => exportFullMutation.mutate()}
                  >
                    {exportFullMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
                    {t("webdav.btn_export_full")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={exportFullMutation.isPending || exportConfigMutation.isPending}
                    onClick={() => exportConfigMutation.mutate()}
                  >
                    {exportConfigMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
                    {t("webdav.btn_export_config")}
                  </Button>
                </div>

                {/* Import */}
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      try {
                        const json = await readBackupFile(file)
                        const summary = await validateBackupFile(json)
                        setImportJson(json)
                        setImportSummary(summary)
                        setImportDialogOpen(true)
                      } catch (err: any) {
                        toast({ title: t("webdav.import_invalid"), description: err.message, variant: "destructive" })
                      } finally {
                        // Reset file input
                        if (fileInputRef.current) fileInputRef.current.value = ""
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={importMutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                    {t("webdav.btn_import")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Confirm Dialog (shared for sync/import) */}
            <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{confirmDialog.title}</DialogTitle>
                  <DialogDescription>{confirmDialog.message}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}>
                    {tc("btn.cancel")}
                  </Button>
                  <Button variant="destructive" onClick={confirmDialog.onConfirm}>
                    {tc("btn.confirm") || "Confirm"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Import Preview Dialog */}
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("webdav.import_confirm_title")}</DialogTitle>
                  {importSummary && (
                    <DialogDescription>
                      {importSummary.scope === "full"
                        ? t("webdav.import_confirm_full", { count: String(importSummary.document_count) })
                        : t("webdav.import_confirm_config")}
                    </DialogDescription>
                  )}
                </DialogHeader>
                {importSummary && (
                  <div className="rounded-lg border p-3 text-sm space-y-1">
                    <p className="font-medium">{t("webdav.import_summary")}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">{t("webdav.import_summary_version")}</span>
                      <span>v{importSummary.version} (schema {importSummary.schema_version})</span>
                      <span className="text-muted-foreground">{t("webdav.import_summary_scope")}</span>
                      <span>{t(`webdav.scope_${importSummary.scope}` as any)}</span>
                      <span className="text-muted-foreground">{t("webdav.import_summary_source")}</span>
                      <span>{importSummary.source === "local-export" ? t("webdav.source_local") : t("webdav.source_webdav")}</span>
                      <span className="text-muted-foreground">{t("webdav.import_summary_time")}</span>
                      <span>{new Date(importSummary.created_at).toLocaleString()}</span>
                      <span className="text-muted-foreground">{t("webdav.import_summary_settings")}</span>
                      <span>{importSummary.settings_count}</span>
                      {importSummary.scope === "full" && (
                        <>
                          <span className="text-muted-foreground">{t("webdav.import_summary_documents")}</span>
                          <span>{importSummary.document_count}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                    {tc("btn.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={importMutation.isPending}
                    onClick={() => {
                      setImportDialogOpen(false)
                      importMutation.mutate()
                    }}
                  >
                    {importMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {tc("btn.confirm") || "Confirm"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>

        {/* ---- RAG & Indexing ---- */}
        <TabsContent value="rag">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("rag.title")}</CardTitle>
                <CardDescription>{t("rag.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("rag.chunk_size")}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={ragChunkSize}
                      onChange={(e) => setRagChunkSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("rag.chunk_overlap")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={ragChunkOverlap}
                      onChange={(e) => setRagChunkOverlap(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t("rag.backend_label")}</Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-input bg-background"
                    value={ragVectorBackend}
                    onChange={(e) => setRagVectorBackend(e.target.value)}
                  >
                    <option value="sqlite">{t("rag.backend_sqlite")}</option>
                    <option value="zvec">{t("rag.backend_zvec")}</option>
                  </select>
                  <p className="text-xs text-muted-foreground">{t("rag.backend_hint")}</p>
                </div>

                <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{t("rag.zvec_runtime_title")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("rag.zvec_runtime_description")}
                      </p>
                    </div>
                    <Badge
                      variant={
                        zvecStatus?.available && zvecStatus?.platform_supported
                          ? "default"
                          : "destructive"
                      }
                    >
                      {zvecStatus?.available && zvecStatus?.platform_supported
                        ? t("rag.status_ready")
                        : t("rag.status_unavailable")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {zvecStatus?.message || t("rag.status_checking")}
                  </p>
                  {zvecStatus?.version && (
                    <p className="text-xs text-muted-foreground">
                      {t("rag.version", { version: zvecStatus.version })}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t("rag.zvec_python_path")}</Label>
                  <Input
                    placeholder={defaultPythonPath}
                    value={zvecPythonPath}
                    onChange={(e) => setZvecPythonPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("rag.zvec_python_path_hint")}</p>
                </div>

                <div className="space-y-2">
                  <Label>{t("rag.zvec_collections_dir")}</Label>
                  <Input
                    placeholder={t("rag.zvec_collections_dir_hint")}
                    value={zvecCollectionsDir}
                    onChange={(e) => setZvecCollectionsDir(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("rag.zvec_collections_dir_hint")}</p>
                </div>

                {ragVectorBackend === "zvec" && zvecStatus && !zvecStatus.platform_supported && (
                  <p className="text-sm text-destructive">{t("rag.unsupported_platform")}</p>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={() => saveRagSettingsMutation.mutate()}
                    disabled={saveRagSettingsMutation.isPending}
                  >
                    {saveRagSettingsMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {tc("btn.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
