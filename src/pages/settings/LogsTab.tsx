import { useEffect, useMemo, useState } from "react"
import { save } from "@tauri-apps/plugin-dialog"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

const LOG_LEVEL_OPTIONS = ["error", "warning", "info", "debug"] as const

export default function LogsTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [loaded, setLoaded] = useState(false)
  const [logLevel, setLogLevel] = useState<(typeof LOG_LEVEL_OPTIONS)[number]>("info")
  const [retentionDays, setRetentionDays] = useState("30")

  const { data: appSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: api.getAllAppSettings,
  })

  useEffect(() => {
    if (!appSettings || loaded) return
    const map = new Map(appSettings.map((item) => [item.key, item.value]))
    const level = (map.get("logs.level") || "info").toLowerCase()
    const normalizedLevel = level === "warn" ? "warning" : level
    if (LOG_LEVEL_OPTIONS.includes(normalizedLevel as any)) {
      setLogLevel(normalizedLevel as (typeof LOG_LEVEL_OPTIONS)[number])
    }
    setRetentionDays(map.get("logs.retention_days") || "30")
    setLoaded(true)
  }, [appSettings, loaded])

  const normalizedRetentionDays = useMemo(() => {
    const parsed = Number.parseInt(retentionDays, 10)
    if (!Number.isFinite(parsed)) return 30
    return Math.min(3650, Math.max(1, parsed))
  }, [retentionDays])

  const { data: mineruStorageDir } = useQuery({
    queryKey: ["mineruProcessedStorageDir"],
    queryFn: api.getMineruProcessedStorageDir,
  })

  const { data: logs } = useQuery({
    queryKey: ["runtimeLogs", logLevel],
    queryFn: () => api.getRuntimeLogs(300, logLevel),
    refetchInterval: 1000,
  })

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      await api.setAppSetting("logs.level", logLevel)
      await api.setAppSetting("logs.retention_days", String(normalizedRetentionDays))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] })
      toast({ title: t("logs.toast.saved") })
    },
    onError: (error: Error) => {
      toast({
        title: t("logs.toast.save_error"),
        description: error.message,
        variant: "destructive",
      })
    },
  })

  const cleanupMutation = useMutation({
    mutationFn: api.runCleanupNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtimeLogs"] })
      toast({ title: t("logs.toast.cleanup_success") })
    },
    onError: (error: Error) => {
      toast({
        title: t("logs.toast.cleanup_error"),
        description: error.message,
        variant: "destructive",
      })
    },
  })

  const exportMutation = useMutation({
    mutationFn: async () => {
      const outputPath = await save({
        title: t("logs.export_dialog_title"),
        defaultPath: `rosetta-logs-${Date.now()}.log`,
      })
      if (!outputPath) {
        return null
      }

      return api.exportRuntimeLogs(outputPath, {
        minLevel: logLevel,
        days: normalizedRetentionDays,
      })
    },
    onSuccess: (outputPath) => {
      if (!outputPath) return
      toast({ title: t("logs.toast.export_success"), description: outputPath })
    },
    onError: (error: Error) => {
      toast({
        title: t("logs.toast.export_error"),
        description: error.message,
        variant: "destructive",
      })
    },
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("logs.title")}</CardTitle>
          <CardDescription>{t("logs.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("logs.storage_dir")}</Label>
            <Input value={mineruStorageDir ?? ""} readOnly />
            <p className="text-xs text-muted-foreground">{t("logs.storage_dir_hint")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("logs.level")}</Label>
            <select
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={logLevel}
              onChange={(event) => setLogLevel(event.target.value as (typeof LOG_LEVEL_OPTIONS)[number])}
            >
              <option value="error">error</option>
              <option value="warning">warning</option>
              <option value="info">info</option>
              <option value="debug">debug</option>
            </select>
            <p className="text-xs text-muted-foreground">{t("logs.level_hint")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("logs.retention_days")}</Label>
            <Input
              type="number"
              min="1"
              max="3650"
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("logs.retention_days_hint")}</p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={() => cleanupMutation.mutate()} disabled={cleanupMutation.isPending}>
              {t("logs.cleanup_now")}
            </Button>
            <Button variant="outline" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
              {t("logs.export")}
            </Button>
            <Button onClick={() => saveSettingsMutation.mutate()} disabled={saveSettingsMutation.isPending}>
              {tc("btn.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("logs.realtime_title")}</CardTitle>
          <CardDescription>{t("logs.realtime_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[420px] overflow-auto rounded-md border bg-background p-2">
            {logs && logs.length > 0 ? (
              <div className="space-y-2">
                {logs.map((entry) => (
                  <div key={entry.id} className="rounded border px-2 py-1">
                    <div className="text-[11px] text-muted-foreground">
                      {entry.created_at} | {entry.level}
                    </div>
                    <div className="text-sm break-words">{entry.message}</div>
                    {entry.context ? (
                      <div className="text-[11px] text-muted-foreground break-all">{entry.context}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("logs.empty")}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
