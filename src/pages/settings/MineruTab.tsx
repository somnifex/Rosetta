import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Loader2, Play, Square, Circle, Download } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function MineruTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const defaultMineruCloneUrl = "https://github.com/opendatalab/MinerU.git"
  const defaultMineruPipIndexUrl = "https://pypi.org/simple"
  const defaultPythonPath = navigator.platform.startsWith("Win") ? "python" : "python3"
  const defaultOfficialBaseUrl = "https://mineru.net"

  const [mineruMode, setMineruMode] = useState("builtin")
  const [mineruPythonPath, setMineruPythonPath] = useState(defaultPythonPath)
  const [mineruPort, setMineruPort] = useState("8765")
  const [mineruAutoStart, setMineruAutoStart] = useState(false)
  const [mineruExternalUrl, setMineruExternalUrl] = useState("http://localhost:8000")
  const [mineruOfficialBaseUrl, setMineruOfficialBaseUrl] = useState(defaultOfficialBaseUrl)
  const [mineruOfficialApiToken, setMineruOfficialApiToken] = useState("")
  const [mineruOfficialModelVersion, setMineruOfficialModelVersion] = useState("vlm")
  const [mineruOfficialLanguage, setMineruOfficialLanguage] = useState("")
  const [mineruOfficialPageRanges, setMineruOfficialPageRanges] = useState("")
  const [mineruOfficialExtraFormats, setMineruOfficialExtraFormats] = useState("")
  const [mineruOfficialCallbackUrl, setMineruOfficialCallbackUrl] = useState("")
  const [mineruOfficialCallbackSeed, setMineruOfficialCallbackSeed] = useState("")
  const [mineruOfficialEnableFormula, setMineruOfficialEnableFormula] = useState(true)
  const [mineruOfficialEnableTable, setMineruOfficialEnableTable] = useState(true)
  const [mineruOfficialIsOcr, setMineruOfficialIsOcr] = useState(false)
  const [mineruSettingsLoaded, setMineruSettingsLoaded] = useState(false)
  const [mineruUseVenv, setMineruUseVenv] = useState(false)
  const [mineruCloneUrl, setMineruCloneUrl] = useState(defaultMineruCloneUrl)
  const [mineruPipIndexUrl, setMineruPipIndexUrl] = useState(defaultMineruPipIndexUrl)
  const [mineruInstallMethod, setMineruInstallMethod] = useState("pip")
  const [mineruModelSource, setMineruModelSource] = useState("huggingface")
  const [mineruModelsDir, setMineruModelsDir] = useState("")

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
      setMineruOfficialBaseUrl(settingsMap.get("mineru.official_base_url") || defaultOfficialBaseUrl)
      setMineruOfficialApiToken(settingsMap.get("mineru.official_api_token") || "")
      setMineruOfficialModelVersion(settingsMap.get("mineru.official_model_version") || "vlm")
      setMineruOfficialLanguage(settingsMap.get("mineru.official_language") || "")
      setMineruOfficialPageRanges(settingsMap.get("mineru.official_page_ranges") || "")
      setMineruOfficialExtraFormats(settingsMap.get("mineru.official_extra_formats") || "")
      setMineruOfficialCallbackUrl(settingsMap.get("mineru.official_callback_url") || "")
      setMineruOfficialCallbackSeed(settingsMap.get("mineru.official_callback_seed") || "")
      setMineruOfficialEnableFormula(settingsMap.get("mineru.official_enable_formula") !== "false")
      setMineruOfficialEnableTable(settingsMap.get("mineru.official_enable_table") !== "false")
      setMineruOfficialIsOcr(settingsMap.get("mineru.official_is_ocr") === "true")
      setMineruUseVenv(settingsMap.get("mineru.use_venv") === "true")
      setMineruCloneUrl(settingsMap.get("mineru.clone_url") || defaultMineruCloneUrl)
      setMineruPipIndexUrl(settingsMap.get("mineru.pip_index_url") || defaultMineruPipIndexUrl)
      setMineruInstallMethod(settingsMap.get("mineru.install_method") || "pip")
      setMineruModelSource(settingsMap.get("mineru.model_source") || "huggingface")
      setMineruModelsDir(settingsMap.get("mineru.models_dir") || "")
      setMineruSettingsLoaded(true)
    }
  }, [
    appSettings,
    defaultMineruCloneUrl,
    defaultMineruPipIndexUrl,
    defaultOfficialBaseUrl,
    mineruSettingsLoaded,
  ])

  const { data: mineruStatus } = useQuery({
    queryKey: ["mineruStatus"],
    queryFn: api.getMinerUStatus,
    refetchInterval: mineruMode === "builtin" ? 3000 : false,
  })

  const { data: venvExists } = useQuery({
    queryKey: ["venvExists"],
    queryFn: api.checkVenvExists,
    enabled: mineruMode === "builtin",
  })

  const { data: venvStatusData } = useQuery({
    queryKey: ["venvStatus"],
    queryFn: api.getVenvStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "creating" ? 2000 : false
    },
    enabled: mineruMode === "builtin",
  })

  const { data: modelDownloadStatusData } = useQuery({
    queryKey: ["modelDownloadStatus"],
    queryFn: api.getModelDownloadStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "downloading" ? 1000 : false
    },
    enabled: mineruMode === "builtin",
  })

  const venvStatus = venvStatusData?.status || (venvExists ? "ready" : "not_created")

  const saveMineruSettingsMutation = useMutation({
    mutationFn: async () => {
      await api.setAppSetting("mineru.mode", mineruMode)
      await api.setAppSetting("mineru.python_path", mineruPythonPath)
      await api.setAppSetting("mineru.port", mineruPort)
      await api.setAppSetting("mineru.auto_start", mineruAutoStart ? "true" : "false")
      await api.setAppSetting("mineru.external_url", mineruExternalUrl)
      await api.setAppSetting("mineru.official_base_url", mineruOfficialBaseUrl.trim() || defaultOfficialBaseUrl)
      await api.setAppSetting("mineru.official_api_token", mineruOfficialApiToken.trim())
      await api.setAppSetting("mineru.official_model_version", mineruOfficialModelVersion)
      await api.setAppSetting("mineru.official_language", mineruOfficialLanguage.trim())
      await api.setAppSetting("mineru.official_page_ranges", mineruOfficialPageRanges.trim())
      await api.setAppSetting("mineru.official_extra_formats", mineruOfficialExtraFormats.trim())
      await api.setAppSetting("mineru.official_callback_url", mineruOfficialCallbackUrl.trim())
      await api.setAppSetting("mineru.official_callback_seed", mineruOfficialCallbackSeed.trim())
      await api.setAppSetting("mineru.official_enable_formula", mineruOfficialEnableFormula ? "true" : "false")
      await api.setAppSetting("mineru.official_enable_table", mineruOfficialEnableTable ? "true" : "false")
      await api.setAppSetting("mineru.official_is_ocr", mineruOfficialIsOcr ? "true" : "false")
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
    await saveMineruSettingsMutation.mutateAsync()
    startMineruMutation.mutate()
  }

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
    await saveMineruSettingsMutation.mutateAsync()
    setupVenvMutation.mutate()
  }

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mineru.title")}</CardTitle>
        <CardDescription>{t("mineru.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode selector */}
        <div className="space-y-3">
          <Label>{t("mineru.mode_label")}</Label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                data-setting-key="mineru.mode"
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
                data-setting-key="mineru.mode"
                type="radio"
                name="mineruMode"
                value="external"
                checked={mineruMode === "external"}
                onChange={() => setMineruMode("external")}
                className="accent-primary"
              />
              <span className="text-sm">{t("mineru.mode_external")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                data-setting-key="mineru.mode"
                type="radio"
                name="mineruMode"
                value="official"
                checked={mineruMode === "official"}
                onChange={() => setMineruMode("official")}
                className="accent-primary"
              />
              <span className="text-sm">{t("mineru.mode_official")}</span>
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
                data-setting-key="mineru.python_path"
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
                data-setting-key="mineru.port"
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
                    data-setting-key="mineru.use_venv"
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
                      data-setting-key="mineru.install_method"
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
                      data-setting-key="mineru.install_method"
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
                  data-setting-key="mineru.clone_url"
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
                  data-setting-key="mineru.pip_index_url"
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
                  data-setting-key="mineru.model_source"
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
                    data-setting-key="mineru.models_dir"
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
                data-setting-key="mineru.auto_start"
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
                data-setting-key="mineru.external_url"
                placeholder="http://localhost:8000"
                value={mineruExternalUrl}
                onChange={(e) => setMineruExternalUrl(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => testMineruMutation.mutate({ mode: "external", baseUrl: mineruExternalUrl })}
              disabled={testMineruMutation.isPending}
            >
              {testMineruMutation.isPending ? tc("btn.testing") : tc("btn.test_connection")}
            </Button>
          </div>
        )}

        {mineruMode === "official" && (
          <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div>
              <p className="font-medium text-sm">{t("mineru.official.title")}</p>
              <p className="text-xs text-muted-foreground">{t("mineru.official.description")}</p>
            </div>

            <p className="text-xs text-muted-foreground">{t("mineru.official.connection_hint")}</p>

            <div className="space-y-2">
              <Label>{t("mineru.official.base_url_label")}</Label>
              <Input
                data-setting-key="mineru.official_base_url"
                placeholder="https://mineru.net"
                value={mineruOfficialBaseUrl}
                onChange={(e) => setMineruOfficialBaseUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("mineru.official.token_label")}</Label>
              <Input
                data-setting-key="mineru.official_api_token"
                type="password"
                placeholder={t("mineru.official.token_placeholder")}
                value={mineruOfficialApiToken}
                onChange={(e) => setMineruOfficialApiToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("mineru.official.token_hint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("mineru.official.model_version_label")}</Label>
              <select
                data-setting-key="mineru.official_model_version"
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                value={mineruOfficialModelVersion}
                onChange={(e) => setMineruOfficialModelVersion(e.target.value)}
              >
                <option value="pipeline">{t("mineru.official.model_version_pipeline")}</option>
                <option value="vlm">{t("mineru.official.model_version_vlm")}</option>
                <option value="MinerU-HTML">{t("mineru.official.model_version_html")}</option>
              </select>
              <p className="text-xs text-muted-foreground">{t("mineru.official.model_version_hint")}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("mineru.official.language_label")}</Label>
                <Input
                  data-setting-key="mineru.official_language"
                  placeholder={t("mineru.official.language_placeholder")}
                  value={mineruOfficialLanguage}
                  onChange={(e) => setMineruOfficialLanguage(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("mineru.official.language_hint")}</p>
              </div>

              <div className="space-y-2">
                <Label>{t("mineru.official.page_ranges_label")}</Label>
                <Input
                  data-setting-key="mineru.official_page_ranges"
                  placeholder={t("mineru.official.page_ranges_placeholder")}
                  value={mineruOfficialPageRanges}
                  onChange={(e) => setMineruOfficialPageRanges(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("mineru.official.page_ranges_hint")}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("mineru.official.extra_formats_label")}</Label>
              <Input
                data-setting-key="mineru.official_extra_formats"
                placeholder={t("mineru.official.extra_formats_placeholder")}
                value={mineruOfficialExtraFormats}
                onChange={(e) => setMineruOfficialExtraFormats(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("mineru.official.extra_formats_hint")}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("mineru.official.callback_url_label")}</Label>
                <Input
                  data-setting-key="mineru.official_callback_url"
                  placeholder={t("mineru.official.callback_url_placeholder")}
                  value={mineruOfficialCallbackUrl}
                  onChange={(e) => setMineruOfficialCallbackUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("mineru.official.callback_url_hint")}</p>
              </div>

              <div className="space-y-2">
                <Label>{t("mineru.official.callback_seed_label")}</Label>
                <Input
                  data-setting-key="mineru.official_callback_seed"
                  placeholder={t("mineru.official.callback_seed_placeholder")}
                  value={mineruOfficialCallbackSeed}
                  onChange={(e) => setMineruOfficialCallbackSeed(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("mineru.official.callback_seed_hint")}</p>
              </div>
            </div>

            <div className="space-y-3 border rounded-lg p-4 bg-background/50">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t("mineru.official.enable_formula_label")}</p>
                <Switch
                  data-setting-key="mineru.official_enable_formula"
                  checked={mineruOfficialEnableFormula}
                  onCheckedChange={setMineruOfficialEnableFormula}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t("mineru.official.enable_table_label")}</p>
                <Switch
                  data-setting-key="mineru.official_enable_table"
                  checked={mineruOfficialEnableTable}
                  onCheckedChange={setMineruOfficialEnableTable}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t("mineru.official.is_ocr_label")}</p>
                <Switch
                  data-setting-key="mineru.official_is_ocr"
                  checked={mineruOfficialIsOcr}
                  onCheckedChange={setMineruOfficialIsOcr}
                />
              </div>
            </div>

            <Button
              variant="outline"
              onClick={() =>
                testMineruMutation.mutate({
                  mode: "official",
                  baseUrl: mineruOfficialBaseUrl,
                  apiToken: mineruOfficialApiToken,
                })
              }
              disabled={testMineruMutation.isPending || !mineruOfficialApiToken.trim()}
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
  )
}
