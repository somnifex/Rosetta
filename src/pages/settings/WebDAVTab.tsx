import { useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
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
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Eye, EyeOff, Loader2, Upload, Download, RefreshCw, Save, CheckCircle, XCircle, Clock, FileUp, FileDown } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function WebDAVTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()

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
      queryClient.invalidateQueries({ queryKey: ["appSettings"] })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["allDocumentTags"] })
      queryClient.invalidateQueries({ queryKey: ["categories"] })
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

  const importMutation = useMutation({
    mutationFn: async () => {
      await importBackup(importJson)
    },
    onSuccess: () => {
      setImportJson("")
      setImportSummary(null)
      queryClient.invalidateQueries({ queryKey: ["appSettings"] })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["allDocumentTags"] })
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      toast({ title: t("webdav.import_success") })
    },
    onError: (error: any) => {
      toast({ title: t("webdav.import_error"), description: error.message, variant: "destructive" })
    },
  })

  return (
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
              placeholder="/Rosseta"
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
  )
}
