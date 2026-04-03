import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { countActiveProvidersForType } from "@/lib/providers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Loader2, Download, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function RagTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const defaultPythonPath = navigator.platform.startsWith("Win") ? "python" : "python3"

  const [ragSettingsLoaded, setRagSettingsLoaded] = useState(false)
  const [ragChunkSize, setRagChunkSize] = useState("512")
  const [ragChunkOverlap, setRagChunkOverlap] = useState("50")
  const [ragVectorBackend, setRagVectorBackend] = useState("zvec")
  const [zvecPythonPath, setZvecPythonPath] = useState(defaultPythonPath)
  const [zvecUseVenv, setZvecUseVenv] = useState(false)
  const [zvecSystemPython, setZvecSystemPython] = useState(defaultPythonPath)
  const [zvecPipIndexUrl, setZvecPipIndexUrl] = useState("https://pypi.org/simple")
  const [ragRerankerMode, setRagRerankerMode] = useState("disabled")
  const [ragRerankerTopN, setRagRerankerTopN] = useState("5")

  const { data: appSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: api.getAllAppSettings,
  })

  useEffect(() => {
    if (appSettings && !ragSettingsLoaded) {
      const settingsMap = new Map(appSettings.map((s) => [s.key, s.value]))
      setRagChunkSize(settingsMap.get("rag.chunk_size") || "512")
      setRagChunkOverlap(settingsMap.get("rag.chunk_overlap") || "50")
      setRagVectorBackend(settingsMap.get("rag.vector_backend") || "zvec")
      setZvecPythonPath(settingsMap.get("rag.zvec_python_path") || defaultPythonPath)
      setZvecUseVenv((settingsMap.get("rag.zvec_use_venv") || "false") === "true")
      setZvecSystemPython(settingsMap.get("rag.zvec_system_python") || defaultPythonPath)
      setZvecPipIndexUrl(settingsMap.get("rag.zvec_pip_index_url") || "https://pypi.org/simple")
      setRagRerankerMode(settingsMap.get("rag.reranker_mode") || "disabled")
      setRagRerankerTopN(settingsMap.get("rag.reranker_top_n") || "5")
      setRagSettingsLoaded(true)
    }
  }, [appSettings, defaultPythonPath, ragSettingsLoaded])

  const { data: zvecStatus } = useQuery({
    queryKey: ["zvecStatus"],
    queryFn: api.getZvecStatus,
    enabled: ragSettingsLoaded,
  })

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
  })

  const { data: zvecVenvExists } = useQuery({
    queryKey: ["zvecVenvExists"],
    queryFn: api.checkZvecVenvExists,
    enabled: ragSettingsLoaded,
  })

  const { data: zvecVenvStatusData } = useQuery({
    queryKey: ["zvecVenvStatus"],
    queryFn: api.getZvecVenvStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "creating" ? 2000 : false
    },
    enabled: ragSettingsLoaded,
  })

  const zvecVenvStatus = zvecVenvStatusData?.status || (zvecVenvExists ? "ready" : "not_created")

  const saveRagSettingsMutation = useMutation({
    mutationFn: async () => {
      await api.setAppSetting("rag.chunk_size", ragChunkSize.trim() || "512")
      await api.setAppSetting("rag.chunk_overlap", ragChunkOverlap.trim() || "50")
      await api.setAppSetting("rag.vector_backend", ragVectorBackend)
      await api.setAppSetting("rag.zvec_python_path", zvecPythonPath.trim() || defaultPythonPath)
      await api.setAppSetting("rag.zvec_collections_dir", "")
      await api.setAppSetting("rag.zvec_use_venv", zvecUseVenv ? "true" : "false")
      await api.setAppSetting("rag.zvec_system_python", zvecSystemPython.trim() || defaultPythonPath)
      await api.setAppSetting("rag.zvec_pip_index_url", zvecPipIndexUrl.trim() || "https://pypi.org/simple")
      await api.setAppSetting("rag.reranker_mode", ragRerankerMode)
      await api.setAppSetting("rag.reranker_top_n", ragRerankerTopN.trim() || "5")
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

  const setupZvecVenvMutation = useMutation({
    mutationFn: api.setupZvecVenv,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zvecVenvStatus"] })
      toast({ title: t("rag.zvec_venv.toast.started") })
    },
    onError: (err: Error) => {
      toast({ title: t("rag.zvec_venv.toast.error_title"), description: err.message, variant: "destructive" })
    },
  })

  const handleSetupZvecVenv = async () => {
    await saveRagSettingsMutation.mutateAsync()
    setupZvecVenvMutation.mutate()
  }

  const { data: rerankerDepsStatus, refetch: refetchRerankerDeps } = useQuery({
    queryKey: ["rerankerDepsStatus"],
    queryFn: api.probeRerankerStatus,
    enabled: ragRerankerMode === "local",
  })

  const installRerankerDepsMutation = useMutation({
    mutationFn: api.installRerankerDeps,
    onSuccess: () => {
      toast({ title: t("rag.reranker.deps_installed") })
      refetchRerankerDeps()
    },
    onError: (err: Error) => {
      toast({ title: t("rag.reranker.deps_install_failed"), description: err.message, variant: "destructive" })
    },
  })

  const { data: rerankerModelStatus } = useQuery({
    queryKey: ["rerankerModelStatus"],
    queryFn: api.getRerankerModelStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "downloading" ? 1500 : false
    },
    enabled: ragRerankerMode === "local",
  })

  const downloadRerankerModelMutation = useMutation({
    mutationFn: api.downloadRerankerModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rerankerModelStatus"] })
      toast({ title: t("rag.reranker.model_download_started") })
    },
    onError: (err: Error) => {
      toast({ title: t("rag.reranker.model_download_error"), description: err.message, variant: "destructive" })
    },
  })

  const activeRerankProviderCount = countActiveProvidersForType(providers, "rerank")

  return (
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
                data-setting-key="rag.chunk_size"
                type="number"
                min={1}
                value={ragChunkSize}
                onChange={(e) => setRagChunkSize(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("rag.chunk_overlap")}</Label>
              <Input
                data-setting-key="rag.chunk_overlap"
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
              data-setting-key="rag.vector_backend"
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

          {/* Zvec Venv Setup */}
          <div className="space-y-3 border rounded-lg p-4 bg-background/50">
            <div>
              <p className="font-medium text-sm">{t("rag.zvec_venv.title")}</p>
              <p className="text-xs text-muted-foreground">{t("rag.zvec_venv.description")}</p>
            </div>

            <div className="flex items-center gap-2">
              <Label>{t("mineru.builtin.status_label")}</Label>
              {zvecVenvStatus === "ready" ? (
                <Badge variant="default">{t("rag.zvec_venv.status_ready")}</Badge>
              ) : zvecVenvStatus === "creating" ? (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("rag.zvec_venv.status_creating")}
                </Badge>
              ) : zvecVenvStatus === "failed" ? (
                <Badge variant="destructive">{t("rag.zvec_venv.status_failed")}</Badge>
              ) : (
                <Badge variant="outline">{t("rag.zvec_venv.status_not_created")}</Badge>
              )}
            </div>

            {zvecVenvStatus === "creating" && zvecVenvStatusData?.message && (
              <p className="text-xs text-muted-foreground">{zvecVenvStatusData.message}</p>
            )}
            {zvecVenvStatus === "failed" && zvecVenvStatusData?.message && (
              <p className="text-xs text-destructive font-mono break-all">{zvecVenvStatusData.message}</p>
            )}
            {zvecVenvStatus === "ready" && zvecVenvStatusData?.message && (
              <p className="text-xs text-muted-foreground">{zvecVenvStatusData.message}</p>
            )}

            {zvecVenvStatus === "ready" && (
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t("rag.zvec_venv.use_venv_label")}</p>
                <Switch
                  data-setting-key="rag.zvec_use_venv"
                  checked={zvecUseVenv}
                  onCheckedChange={setZvecUseVenv}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>{t("rag.zvec_venv.system_python_label")}</Label>
              <Input
                data-setting-key="rag.zvec_system_python"
                placeholder={defaultPythonPath}
                value={zvecSystemPython}
                onChange={(e) => setZvecSystemPython(e.target.value)}
                disabled={zvecVenvStatus === "creating"}
              />
              <p className="text-xs text-muted-foreground">{t("rag.zvec_venv.system_python_hint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("rag.zvec_venv.pip_index_url_label")}</Label>
              <Input
                data-setting-key="rag.zvec_pip_index_url"
                placeholder="https://pypi.org/simple"
                value={zvecPipIndexUrl}
                onChange={(e) => setZvecPipIndexUrl(e.target.value)}
                disabled={zvecVenvStatus === "creating"}
              />
              <p className="text-xs text-muted-foreground">{t("rag.zvec_venv.pip_index_url_hint")}</p>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={zvecVenvStatus === "creating" || setupZvecVenvMutation.isPending}
              onClick={handleSetupZvecVenv}
            >
              {zvecVenvStatus === "creating" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {zvecVenvStatus === "ready" ? t("rag.zvec_venv.btn_reinstall") : t("rag.zvec_venv.btn_setup")}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>{t("rag.zvec_python_path")}</Label>
            <Input
              data-setting-key="rag.zvec_python_path"
              placeholder={defaultPythonPath}
              value={zvecPythonPath}
              onChange={(e) => setZvecPythonPath(e.target.value)}
              disabled={zvecUseVenv && zvecVenvStatus === "ready"}
            />
            {zvecUseVenv && zvecVenvStatus === "ready" ? (
              <p className="text-xs text-muted-foreground">{t("rag.zvec_venv.using_venv_hint")}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("rag.zvec_python_path_hint")}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("rag.zvec_collections_dir")}</Label>
            <Input
              value={zvecStatus?.collections_dir ?? ""}
              readOnly
            />
            <p className="text-xs text-muted-foreground">{t("rag.zvec_collections_dir_hint")}</p>
          </div>

          {ragVectorBackend === "zvec" && zvecStatus != null && (!zvecStatus.platform_supported || !zvecStatus.available) && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">{t("rag.fallback_banner_title")}</p>
                  <p className="text-xs text-muted-foreground">{t("rag.fallback_banner_description")}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setRagVectorBackend("sqlite")
                    await api.setAppSetting("rag.vector_backend", "sqlite")
                    queryClient.invalidateQueries({ queryKey: ["appSettings"] })
                    queryClient.invalidateQueries({ queryKey: ["zvecStatus"] })
                    toast({ title: t("rag.toast.saved") })
                  }}
                >
                  {t("rag.fallback_banner_switch_btn")}
                </Button>
                <Badge variant="secondary">{t("rag.fallback_status_active")}</Badge>
              </div>
            </div>
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

      {/* Reranker Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t("rag.reranker.title")}</CardTitle>
          <CardDescription>{t("rag.reranker.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode selector */}
          <div className="space-y-3">
            <Label>{t("rag.reranker.mode_label")}</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  data-setting-key="rag.reranker_mode"
                  type="radio"
                  name="rerankerMode"
                  value="disabled"
                  checked={ragRerankerMode === "disabled"}
                  onChange={() => setRagRerankerMode("disabled")}
                  className="accent-primary"
                />
                <span className="text-sm">{t("rag.reranker.mode_disabled")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  data-setting-key="rag.reranker_mode"
                  type="radio"
                  name="rerankerMode"
                  value="local"
                  checked={ragRerankerMode === "local"}
                  onChange={() => setRagRerankerMode("local")}
                  className="accent-primary"
                />
                <span className="text-sm">{t("rag.reranker.mode_local")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  data-setting-key="rag.reranker_mode"
                  type="radio"
                  name="rerankerMode"
                  value="remote"
                  checked={ragRerankerMode === "remote"}
                  onChange={() => setRagRerankerMode("remote")}
                  className="accent-primary"
                />
                <span className="text-sm">{t("rag.reranker.mode_remote")}</span>
              </label>
            </div>
          </div>

          {/* Local mode sub-panel */}
          {ragRerankerMode === "local" && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
              <div>
                <p className="font-medium text-sm">{t("rag.reranker.local_title")}</p>
                <p className="text-xs text-muted-foreground">{t("rag.reranker.local_description")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Label>{t("rag.reranker.local_model")}</Label>
                <Badge variant="outline">cross-encoder/ms-marco-MiniLM-L6-v2</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{t("rag.reranker.local_model_hint")}</p>
              <div className="flex items-center gap-2">
                <Label>{t("mineru.builtin.status_label")}</Label>
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
              <div className="flex items-center gap-2">
                <Label>{t("rag.reranker.deps_label")}</Label>
                <Badge variant={rerankerDepsStatus?.available ? "default" : "destructive"}>
                  {rerankerDepsStatus?.available
                    ? t("rag.reranker.deps_ready")
                    : t("rag.reranker.deps_missing")}
                </Badge>
                {rerankerDepsStatus && !rerankerDepsStatus.available && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => installRerankerDepsMutation.mutate()}
                    disabled={installRerankerDepsMutation.isPending}
                  >
                    {installRerankerDepsMutation.isPending && (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    {t("rag.reranker.deps_install")}
                  </Button>
                )}
              </div>

              {/* Model download section */}
              <div className="space-y-2 border-t pt-3">
                <p className="font-medium text-sm">{t("rag.reranker.model_title")}</p>
                <p className="text-xs text-muted-foreground">{t("rag.reranker.model_description")}</p>

                <div className="flex items-center gap-2">
                  <Label>{t("mineru.builtin.status_label")}</Label>
                  {rerankerModelStatus?.status === "completed" ? (
                    <Badge variant="default">{t("rag.reranker.model_status_completed")}</Badge>
                  ) : rerankerModelStatus?.status === "downloading" ? (
                    <Badge variant="secondary" className="gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("rag.reranker.model_status_downloading")}
                    </Badge>
                  ) : rerankerModelStatus?.status === "failed" ? (
                    <Badge variant="destructive">{t("rag.reranker.model_status_failed")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("rag.reranker.model_status_idle")}</Badge>
                  )}
                </div>

                {rerankerModelStatus?.status === "downloading" && rerankerModelStatus.message && (
                  <p className="text-xs text-muted-foreground truncate" title={rerankerModelStatus.message}>
                    {rerankerModelStatus.message}
                  </p>
                )}
                {rerankerModelStatus?.status === "failed" && rerankerModelStatus.message && (
                  <p className="text-xs text-destructive font-mono break-all">{rerankerModelStatus.message}</p>
                )}
                {rerankerModelStatus?.status === "completed" && rerankerModelStatus.message && (
                  <p className="text-xs text-muted-foreground truncate" title={rerankerModelStatus.message}>
                    {rerankerModelStatus.message}
                  </p>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !rerankerDepsStatus?.available ||
                    rerankerModelStatus?.status === "downloading" ||
                    downloadRerankerModelMutation.isPending
                  }
                  onClick={() => downloadRerankerModelMutation.mutate()}
                >
                  {rerankerModelStatus?.status === "downloading" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {rerankerModelStatus?.status === "completed"
                    ? t("rag.reranker.model_btn_redownload")
                    : t("rag.reranker.model_btn_download")}
                </Button>
              </div>
            </div>
          )}

          {/* Remote mode sub-panel */}
          {ragRerankerMode === "remote" && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
              <div>
                <p className="font-medium text-sm">{t("rag.reranker.remote_title")}</p>
                <p className="text-xs text-muted-foreground">{t("rag.reranker.remote_description")}</p>
              </div>
              {activeRerankProviderCount === 0 ? (
                <p className="text-sm text-destructive">{t("rag.reranker.no_channels")}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("rag.reranker.channels_configured", { count: String(activeRerankProviderCount) })}
                </p>
              )}
            </div>
          )}

          {/* Top N setting */}
          {ragRerankerMode !== "disabled" && (
            <div className="space-y-2">
              <Label>{t("rag.reranker.top_n")}</Label>
              <Input
                data-setting-key="rag.reranker_top_n"
                type="number"
                min={1}
                max={50}
                className="w-24"
                value={ragRerankerTopN}
                onChange={(e) => setRagRerankerTopN(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("rag.reranker.top_n_hint")}</p>
            </div>
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
  )
}
