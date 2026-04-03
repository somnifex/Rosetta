import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useQuery } from "@tanstack/react-query"
import { getVersion } from "@tauri-apps/api/app"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update as TauriUpdate } from "@tauri-apps/plugin-updater"
import { useTranslation } from "react-i18next"
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restart_required"
  | "up_to_date"
  | "error"

interface AppUpdaterContextValue {
  currentVersion: string
  updateStatus: AppUpdateStatus
  updateVersion: string
  updateBody: string
  downloadProgress: number
  checkForUpdates: () => Promise<void>
  downloadAndInstallUpdate: () => Promise<void>
  requestRelaunchConfirmation: () => void
}

interface CheckForUpdatesOptions {
  autoDownload?: boolean
  notifyIfAvailable?: boolean
  silentIfUpToDate?: boolean
  silentOnError?: boolean
}

const AppUpdaterContext = createContext<AppUpdaterContextValue | null>(null)

let startupUpdateCheckHandled = false

function isTauriRuntime() {
  return Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function readBooleanSetting(
  settings: Array<{ key: string; value: string }> | undefined,
  key: string
) {
  if (!settings) return false
  return settings.some((item) => item.key === key && item.value === "true")
}

function getErrorDescription(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return undefined
}

export function AppUpdaterProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation(["settings", "common"])
  const { toast } = useToast()

  const isTauri = isTauriRuntime()

  const [currentVersion, setCurrentVersion] = useState("")
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>("idle")
  const [updateVersion, setUpdateVersion] = useState("")
  const [updateBody, setUpdateBody] = useState("")
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [availableUpdate, setAvailableUpdate] = useState<TauriUpdate | null>(null)
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)

  const statusRef = useRef<AppUpdateStatus>("idle")
  const availableUpdateRef = useRef<TauriUpdate | null>(null)

  useEffect(() => {
    statusRef.current = updateStatus
  }, [updateStatus])

  useEffect(() => {
    availableUpdateRef.current = availableUpdate
  }, [availableUpdate])

  useEffect(() => {
    if (!isTauri) return

    getVersion().then(setCurrentVersion).catch(() => {})
  }, [isTauri])

  useEffect(() => {
    return () => {
      if (!availableUpdateRef.current) return
      void availableUpdateRef.current.close().catch(() => {})
    }
  }, [])

  const { data: appSettings, isError: appSettingsError } = useQuery({
    queryKey: ["appSettings"],
    queryFn: api.getAllAppSettings,
    enabled: isTauri,
    retry: false,
    staleTime: 30_000,
  })

  const storeAvailableUpdate = useCallback((nextUpdate: TauriUpdate | null) => {
    setAvailableUpdate((currentUpdate) => {
      if (currentUpdate && currentUpdate !== nextUpdate) {
        void currentUpdate.close().catch(() => {})
      }
      return nextUpdate
    })
  }, [])

  const downloadAndInstallKnownUpdate = useCallback(
    async (nextUpdate: TauriUpdate, silentOnError = false) => {
      if (!isTauri) return

      if (
        statusRef.current === "downloading" ||
        statusRef.current === "installing" ||
        statusRef.current === "checking"
      ) {
        return
      }

      storeAvailableUpdate(nextUpdate)
      setUpdateVersion(nextUpdate.version)
      setUpdateBody(nextUpdate.body ?? "")
      setDownloadProgress(0)

      try {
        setUpdateStatus("downloading")

        let downloaded = 0
        let contentLength = 0

        await nextUpdate.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = event.data.contentLength ?? 0
              break
            case "Progress":
              downloaded += event.data.chunkLength
              if (contentLength > 0) {
                setDownloadProgress(Math.round((downloaded / contentLength) * 100))
              }
              break
            case "Finished":
              setUpdateStatus("installing")
              break
          }
        })

        setUpdateStatus("restart_required")
        setRestartDialogOpen(true)

        toast({
          title: t("settings:general.update_ready_title"),
          description: t("settings:general.update_ready_desc", { version: nextUpdate.version }),
        })
      } catch (error) {
        setUpdateStatus("available")
        if (!silentOnError) {
          toast({
            title: t("settings:general.update_error"),
            description: getErrorDescription(error),
            variant: "destructive",
          })
        }
      }
    },
    [isTauri, storeAvailableUpdate, t, toast]
  )

  const checkForUpdatesInternal = useCallback(
    async (options: CheckForUpdatesOptions = {}) => {
      if (!isTauri) return

      if (
        statusRef.current === "checking" ||
        statusRef.current === "downloading" ||
        statusRef.current === "installing"
      ) {
        return
      }

      try {
        setUpdateStatus("checking")
        setDownloadProgress(0)

        const nextUpdate = await check()

        if (!nextUpdate) {
          storeAvailableUpdate(null)
          setUpdateVersion("")
          setUpdateBody("")
          setUpdateStatus("up_to_date")

          if (!options.silentIfUpToDate) {
            toast({ title: t("settings:general.update_up_to_date") })
          }
          return
        }

        storeAvailableUpdate(nextUpdate)
        setUpdateVersion(nextUpdate.version)
        setUpdateBody(nextUpdate.body ?? "")
        setUpdateStatus("available")

        if (options.autoDownload) {
          await downloadAndInstallKnownUpdate(nextUpdate, options.silentOnError)
          return
        }

        if (options.notifyIfAvailable) {
          toast({
            title: t("settings:general.update_available", { version: nextUpdate.version }),
            description: t("settings:general.update_available_desc"),
          })
        }
      } catch (error) {
        setUpdateStatus("error")
        if (!options.silentOnError) {
          toast({
            title: t("settings:general.update_error"),
            description: getErrorDescription(error),
            variant: "destructive",
          })
        }
      }
    },
    [downloadAndInstallKnownUpdate, isTauri, storeAvailableUpdate, t, toast]
  )

  const checkForUpdates = useCallback(async () => {
    await checkForUpdatesInternal()
  }, [checkForUpdatesInternal])

  const downloadAndInstallUpdate = useCallback(async () => {
    if (!isTauri) return

    let nextUpdate = availableUpdate

    if (!nextUpdate) {
      try {
        nextUpdate = await check()
      } catch (error) {
        setUpdateStatus("error")
        toast({
          title: t("settings:general.update_error"),
          description: getErrorDescription(error),
          variant: "destructive",
        })
        return
      }
    }

    if (!nextUpdate) {
      storeAvailableUpdate(null)
      setUpdateVersion("")
      setUpdateBody("")
      setUpdateStatus("up_to_date")
      return
    }

    await downloadAndInstallKnownUpdate(nextUpdate)
  }, [availableUpdate, downloadAndInstallKnownUpdate, isTauri, storeAvailableUpdate, t, toast])

  const requestRelaunchConfirmation = useCallback(() => {
    if (statusRef.current !== "restart_required") return
    setRestartDialogOpen(true)
  }, [])

  const confirmRelaunch = useCallback(async () => {
    try {
      await relaunch()
    } catch (error) {
      toast({
        title: t("settings:general.update_restart_error"),
        description: getErrorDescription(error),
        variant: "destructive",
      })
    }
  }, [t, toast])

  useEffect(() => {
    if (!isTauri || startupUpdateCheckHandled) return
    if (!appSettings && !appSettingsError) return

    startupUpdateCheckHandled = true

    if (!appSettings) return

    const checkUpdatesOnStartup = readBooleanSetting(
      appSettings,
      "general.check_updates_on_startup"
    )
    const autoUpdateEnabled = readBooleanSetting(appSettings, "general.auto_update")

    if (!checkUpdatesOnStartup) return

    void checkForUpdatesInternal({
      autoDownload: autoUpdateEnabled,
      notifyIfAvailable: !autoUpdateEnabled,
      silentIfUpToDate: true,
      silentOnError: true,
    })
  }, [appSettings, appSettingsError, checkForUpdatesInternal, isTauri])

  return (
    <AppUpdaterContext.Provider
      value={{
        currentVersion,
        updateStatus,
        updateVersion,
        updateBody,
        downloadProgress,
        checkForUpdates,
        downloadAndInstallUpdate,
        requestRelaunchConfirmation,
      }}
    >
      {children}
      <ConfirmActionDialog
        open={restartDialogOpen}
        onOpenChange={setRestartDialogOpen}
        title={t("settings:general.update_restart_confirm_title")}
        description={t("settings:general.update_restart_confirm_desc", {
          version: updateVersion || currentVersion,
        })}
        confirmLabel={t("settings:general.update_btn_restart")}
        cancelLabel={t("common:btn.cancel")}
        variant="default"
        onConfirm={() => {
          void confirmRelaunch()
        }}
      />
    </AppUpdaterContext.Provider>
  )
}

export function useAppUpdater() {
  const context = useContext(AppUpdaterContext)

  if (!context) {
    throw new Error("useAppUpdater must be used within AppUpdaterProvider")
  }

  return context
}
