import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAppUpdater } from "@/components/AppUpdaterProvider"
import { api } from "@/lib/api"
import { loadChatBehaviorSettings } from "@/lib/chat"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart"
import {
  getStoredTheme,
  normalizeTheme,
  setStoredTheme,
  THEME_CHANGE_EVENT,
  type AppTheme,
} from "@/lib/theme"

export default function GeneralTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const {
    currentVersion,
    updateStatus,
    updateVersion,
    updateBody,
    downloadProgress,
    checkForUpdates,
    downloadAndInstallUpdate,
    requestRelaunchConfirmation,
  } = useAppUpdater()

  const [loaded, setLoaded] = useState(false)
  const [modelBehaviorDescription, setModelBehaviorDescription] = useState("")
  const [documentAppendPrompt, setDocumentAppendPrompt] = useState("")
  const [longTextRagPrompt, setLongTextRagPrompt] = useState("")
  const [longTextThreshold, setLongTextThreshold] = useState("3000")
  const [defaultAlwaysIncludeFullDocument, setDefaultAlwaysIncludeFullDocument] =
    useState(false)
  const [defaultTargetLanguage, setDefaultTargetLanguage] = useState("")
  const [theme, setTheme] = useState<AppTheme>(getStoredTheme)
  const [autostart, setAutostart] = useState(false)
  const [startSilent, setStartSilent] = useState(false)
  const [checkUpdatesOnStartup, setCheckUpdatesOnStartup] = useState(false)
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false)
  const [acceptPrereleaseUpdates, setAcceptPrereleaseUpdates] = useState(false)

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      if (event instanceof CustomEvent) {
        setTheme(event.detail ?? getStoredTheme())
        return
      }
      setTheme(getStoredTheme())
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener)
    }
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    await checkForUpdates()
  }, [checkForUpdates])

  const handleDownloadAndInstall = useCallback(async () => {
    await downloadAndInstallUpdate()
  }, [downloadAndInstallUpdate])

  const { data: appSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: api.getAllAppSettings,
  })

  useEffect(() => {
    if (loaded || !appSettings) return

    loadChatBehaviorSettings()
      .then(async (settings) => {
        const settingsMap = new Map(appSettings.map((item) => [item.key, item.value]))
        setDefaultTargetLanguage(settingsMap.get("general.default_target_language") ?? "")

        setStartSilent(settingsMap.get("general.start_silent") === "true")
        setCheckUpdatesOnStartup(settingsMap.get("general.check_updates_on_startup") === "true")
        setAutoUpdateEnabled(settingsMap.get("general.auto_update") === "true")
        setAcceptPrereleaseUpdates(
          settingsMap.get("general.accept_prerelease_updates") === "true"
        )

        try {
          const enabled = await isAutostartEnabled()
          setAutostart(enabled)
        } catch {
          // autostart plugin may not be available in dev/browser mode
        }

        setModelBehaviorDescription(settings.modelBehaviorDescription)
        setDocumentAppendPrompt(settings.documentAppendPrompt)
        setLongTextRagPrompt(settings.longTextRagPrompt)
        setLongTextThreshold(String(settings.longTextThreshold))
        setDefaultAlwaysIncludeFullDocument(settings.defaultAlwaysIncludeFullDocument)
        setLoaded(true)
      })
      .catch(() => {
        setLoaded(true)
      })
  }, [appSettings, loaded])

  const saveBehaviorMutation = useMutation({
    mutationFn: async () => {
      await api.setAppSetting("chat.model_behavior_description", modelBehaviorDescription.trim())
      await api.setAppSetting("chat.prompt.document_append", documentAppendPrompt.trim())
      await api.setAppSetting("chat.prompt.long_text_rag", longTextRagPrompt.trim())
      await api.setAppSetting(
        "chat.long_text_threshold",
        String(Math.max(400, Number.parseInt(longTextThreshold, 10) || 3000))
      )
      await api.setAppSetting(
        "chat.default_always_include_full_document",
        defaultAlwaysIncludeFullDocument ? "true" : "false"
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] })
      toast({ title: t("general.chat_behavior_saved") })
    },
    onError: (error: Error) => {
      toast({ title: t("general.chat_behavior_save_error"), description: error.message, variant: "destructive" })
    },
  })

  const saveGeneralMutation = useMutation({
    mutationFn: async () => {
      const normalizedTheme = normalizeTheme(theme)
      await api.setAppSetting("general.default_target_language", defaultTargetLanguage.trim())
      await api.setAppSetting("general.theme", normalizedTheme)
      setStoredTheme(normalizedTheme)

      // Autostart
      try {
        if (autostart) {
          await enableAutostart()
        } else {
          await disableAutostart()
        }
      } catch {
        // autostart plugin may not be available in dev/browser mode
      }

      // Silent start
      await api.setAppSetting("general.start_silent", startSilent ? "true" : "false")
      await api.setAppSetting(
        "general.check_updates_on_startup",
        checkUpdatesOnStartup ? "true" : "false"
      )
      await api.setAppSetting("general.auto_update", autoUpdateEnabled ? "true" : "false")
      await api.setAppSetting(
        "general.accept_prerelease_updates",
        acceptPrereleaseUpdates ? "true" : "false"
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] })
      toast({ title: t("general.basic_saved") })
    },
    onError: (error: Error) => {
      toast({ title: t("general.basic_save_error"), description: error.message, variant: "destructive" })
    },
  })

  return (
    <div className="space-y-4">
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
            <Input
              data-setting-key="general.default_target_language"
              placeholder="English"
              value={defaultTargetLanguage}
              onChange={(event) => setDefaultTargetLanguage(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("general.theme")}</Label>
            <select
              data-setting-key="general.theme"
              className="w-full h-10 px-3 rounded-md border border-input bg-background"
              value={theme}
              onChange={(event) => setTheme(normalizeTheme(event.target.value))}
            >
              <option value="light">{t("general.theme_options.light")}</option>
              <option value="dark">{t("general.theme_options.dark")}</option>
              <option value="system">{t("general.theme_options.system")}</option>
            </select>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("general.autostart")}</p>
              <p className="text-xs text-muted-foreground">{t("general.autostart_desc")}</p>
            </div>
            <Switch
              data-setting-key="general.autostart"
              checked={autostart}
              onCheckedChange={setAutostart}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("general.start_silent")}</p>
              <p className="text-xs text-muted-foreground">{t("general.start_silent_desc")}</p>
            </div>
            <Switch
              data-setting-key="general.start_silent"
              checked={startSilent}
              onCheckedChange={setStartSilent}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("general.check_updates_on_startup")}</p>
              <p className="text-xs text-muted-foreground">
                {t("general.check_updates_on_startup_desc")}
              </p>
            </div>
            <Switch
              data-setting-key="general.check_updates_on_startup"
              checked={checkUpdatesOnStartup}
              onCheckedChange={setCheckUpdatesOnStartup}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("general.auto_update")}</p>
              <p className="text-xs text-muted-foreground">{t("general.auto_update_desc")}</p>
            </div>
            <Switch
              data-setting-key="general.auto_update"
              checked={autoUpdateEnabled}
              onCheckedChange={setAutoUpdateEnabled}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div className="pr-4">
              <p className="text-sm font-medium">{t("general.accept_prerelease_updates")}</p>
              <p className="text-xs text-muted-foreground">
                {t("general.accept_prerelease_updates_desc")}
              </p>
              <p className="mt-1 text-xs text-amber-600">
                {t("general.accept_prerelease_updates_risk")}
              </p>
            </div>
            <Switch
              data-setting-key="general.accept_prerelease_updates"
              checked={acceptPrereleaseUpdates}
              onCheckedChange={setAcceptPrereleaseUpdates}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("general.update")}</p>
              <p className="text-xs text-muted-foreground">{t("general.update_desc")}</p>
              {currentVersion && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("general.current_version")}: v{currentVersion}
                </p>
              )}
              {updateStatus === "checking" && (
                <p className="text-xs text-blue-500 mt-1">{t("general.update_checking")}</p>
              )}
              {updateStatus === "available" && (
                <p className="text-xs text-green-500 mt-1">
                  {t("general.update_available", { version: updateVersion })}
                </p>
              )}
              {updateStatus === "available" && updateVersion.includes("-") && (
                <p className="text-xs text-amber-600 mt-1">
                  {t("general.update_prerelease_notice")}
                </p>
              )}
              {(updateStatus === "available" || updateStatus === "restart_required") && updateBody && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded border bg-muted/30 p-2">
                  <p className="text-xs font-medium mb-1">{t("general.update_notes")}</p>
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-sans">{updateBody}</pre>
                </div>
              )}
              {updateStatus === "downloading" && (
                <p className="text-xs text-blue-500 mt-1">
                  {t("general.update_downloading", { progress: downloadProgress })}
                </p>
              )}
              {updateStatus === "installing" && (
                <p className="text-xs text-blue-500 mt-1">{t("general.update_installing")}</p>
              )}
              {updateStatus === "restart_required" && (
                <p className="text-xs text-amber-600 mt-1">
                  {t("general.update_ready_to_restart", { version: updateVersion })}
                </p>
              )}
              {updateStatus === "up_to_date" && (
                <p className="text-xs text-green-500 mt-1">{t("general.update_up_to_date")}</p>
              )}
              {updateStatus === "error" && (
                <p className="text-xs text-destructive mt-1">{t("general.update_error")}</p>
              )}
            </div>
            <div>
              {updateStatus === "restart_required" ? (
                <Button size="sm" onClick={requestRelaunchConfirmation}>
                  {t("general.update_btn_restart")}
                </Button>
              ) : updateStatus === "available" ? (
                <Button size="sm" onClick={handleDownloadAndInstall}>
                  {t("general.update_btn_download")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void handleCheckUpdate()
                  }}
                  disabled={
                    updateStatus === "checking" ||
                    updateStatus === "downloading" ||
                    updateStatus === "installing"
                  }
                >
                  {t("general.update_btn_check")}
                </Button>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => saveGeneralMutation.mutate()} disabled={saveGeneralMutation.isPending}>
              {tc("btn.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("general.chat_behavior_title")}</CardTitle>
          <CardDescription>{t("general.chat_behavior_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("general.model_behavior_description")}</Label>
            <textarea
              data-setting-key="chat.model_behavior_description"
              value={modelBehaviorDescription}
              onChange={(event) => setModelBehaviorDescription(event.target.value)}
              rows={3}
              className="min-h-[84px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("general.default_full_document")}</p>
              <p className="text-xs text-muted-foreground">{t("general.default_full_document_hint")}</p>
            </div>
            <Switch
              data-setting-key="chat.default_always_include_full_document"
              checked={defaultAlwaysIncludeFullDocument}
              onCheckedChange={setDefaultAlwaysIncludeFullDocument}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("general.long_text_threshold")}</Label>
            <Input
              data-setting-key="chat.long_text_threshold"
              type="number"
              min="400"
              value={longTextThreshold}
              onChange={(event) => setLongTextThreshold(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("general.document_append_prompt")}</Label>
            <textarea
              data-setting-key="chat.prompt.document_append"
              value={documentAppendPrompt}
              onChange={(event) => setDocumentAppendPrompt(event.target.value)}
              rows={6}
              className="min-h-[140px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("general.document_append_prompt_hint")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("general.long_text_rag_prompt")}</Label>
            <textarea
              data-setting-key="chat.prompt.long_text_rag"
              value={longTextRagPrompt}
              onChange={(event) => setLongTextRagPrompt(event.target.value)}
              rows={5}
              className="min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("general.long_text_rag_prompt_hint")}</p>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => saveBehaviorMutation.mutate()} disabled={saveBehaviorMutation.isPending}>
              {tc("btn.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
