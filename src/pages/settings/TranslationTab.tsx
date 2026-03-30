import { useState, useCallback, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  channelStore,
  type TranslatePromptConfig,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT,
  DEFAULT_TRANSLATION_RUNTIME_SETTINGS,
  loadTranslationRuntimeSettings,
  saveTranslationRuntimeSettings,
} from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { RotateCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function TranslationTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [translatePrompt, setTranslatePrompt] = useState<TranslatePromptConfig>(
    () => channelStore.getTranslatePrompt()
  )
  const [loadedRuntimeSettings, setLoadedRuntimeSettings] = useState(false)
  const [chunkSize, setChunkSize] = useState(String(DEFAULT_TRANSLATION_RUNTIME_SETTINGS.chunkSize))
  const [chunkOverlap, setChunkOverlap] = useState(String(DEFAULT_TRANSLATION_RUNTIME_SETTINGS.chunkOverlap))
  const [maxConcurrentRequests, setMaxConcurrentRequests] = useState(
    String(DEFAULT_TRANSLATION_RUNTIME_SETTINGS.maxConcurrentRequests)
  )
  const [maxRequestsPerMinute, setMaxRequestsPerMinute] = useState(
    String(DEFAULT_TRANSLATION_RUNTIME_SETTINGS.maxRequestsPerMinute)
  )
  const [smartOptimizeEnabled, setSmartOptimizeEnabled] = useState(
    DEFAULT_TRANSLATION_RUNTIME_SETTINGS.smartOptimizeEnabled
  )

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: appSettings } = useQuery({
    queryKey: ["translationRuntimeSettings"],
    queryFn: loadTranslationRuntimeSettings,
  })

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!appSettings || loadedRuntimeSettings) return
    setChunkSize(String(appSettings.chunkSize))
    setChunkOverlap(String(appSettings.chunkOverlap))
    setMaxConcurrentRequests(String(appSettings.maxConcurrentRequests))
    setMaxRequestsPerMinute(String(appSettings.maxRequestsPerMinute))
    setSmartOptimizeEnabled(appSettings.smartOptimizeEnabled)
    setLoadedRuntimeSettings(true)
  }, [appSettings, loadedRuntimeSettings])

  const updateTranslatePrompt = useCallback((updates: Partial<TranslatePromptConfig>) => {
    setTranslatePrompt((prev) => {
      const next = { ...prev, ...updates }
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        channelStore.saveTranslatePrompt(next)
      }, 300)
      return next
    })
  }, [])

  const resetTranslatePrompt = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const defaults = { systemPrompt: DEFAULT_SYSTEM_PROMPT, userPrompt: DEFAULT_USER_PROMPT }
    setTranslatePrompt(defaults)
    channelStore.saveTranslatePrompt(defaults)
    toast({ title: t("prompt.toast.reset") })
  }, [t, toast])

  const saveRuntimeSettingsMutation = useMutation({
    mutationFn: async () => {
      const parsedChunkSize = Number.parseInt(chunkSize, 10)
      const normalizedChunkSize = Number.isFinite(parsedChunkSize)
        ? Math.min(Math.max(parsedChunkSize, 256), 32000)
        : DEFAULT_TRANSLATION_RUNTIME_SETTINGS.chunkSize

      const parsedChunkOverlap = Number.parseInt(chunkOverlap, 10)
      const normalizedChunkOverlap = Number.isFinite(parsedChunkOverlap)
        ? Math.min(Math.max(parsedChunkOverlap, 0), normalizedChunkSize - 1)
        : DEFAULT_TRANSLATION_RUNTIME_SETTINGS.chunkOverlap

      const parsedConcurrent = Number.parseInt(maxConcurrentRequests, 10)
      const normalizedConcurrent = Number.isFinite(parsedConcurrent)
        ? Math.min(Math.max(parsedConcurrent, 1), 32)
        : DEFAULT_TRANSLATION_RUNTIME_SETTINGS.maxConcurrentRequests

      const parsedRate = Number.parseInt(maxRequestsPerMinute, 10)
      const normalizedRate = Number.isFinite(parsedRate)
        ? Math.min(Math.max(parsedRate, 1), 600)
        : DEFAULT_TRANSLATION_RUNTIME_SETTINGS.maxRequestsPerMinute

      setChunkSize(String(normalizedChunkSize))
      setChunkOverlap(String(normalizedChunkOverlap))
      setMaxConcurrentRequests(String(normalizedConcurrent))
      setMaxRequestsPerMinute(String(normalizedRate))

      await saveTranslationRuntimeSettings({
        chunkSize: normalizedChunkSize,
        chunkOverlap: normalizedChunkOverlap,
        maxConcurrentRequests: normalizedConcurrent,
        maxRequestsPerMinute: normalizedRate,
        smartOptimizeEnabled,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["translationRuntimeSettings"] })
      toast({ title: t("prompt.runtime.toast.saved") })
    },
    onError: (error: Error) => {
      toast({
        title: t("prompt.runtime.toast.save_error"),
        description: error.message,
        variant: "destructive",
      })
    },
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("prompt.runtime.title")}</CardTitle>
          <CardDescription>{t("prompt.runtime.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("prompt.runtime.chunk_size")}</Label>
              <Input
                type="number"
                min={256}
                max={32000}
                value={chunkSize}
                onChange={(event) => setChunkSize(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("prompt.runtime.chunk_size_desc")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("prompt.runtime.chunk_overlap")}</Label>
              <Input
                type="number"
                min={0}
                value={chunkOverlap}
                onChange={(event) => setChunkOverlap(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("prompt.runtime.chunk_overlap_desc")}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("prompt.runtime.max_concurrent_requests")}</Label>
              <Input
                type="number"
                min={1}
                max={32}
                value={maxConcurrentRequests}
                onChange={(event) => setMaxConcurrentRequests(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("prompt.runtime.max_concurrent_requests_desc")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("prompt.runtime.max_requests_per_minute")}</Label>
              <Input
                type="number"
                min={1}
                max={600}
                value={maxRequestsPerMinute}
                onChange={(event) => setMaxRequestsPerMinute(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("prompt.runtime.max_requests_per_minute_desc")}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("prompt.runtime.smart_optimize")}</p>
              <p className="text-xs text-muted-foreground">
                {t("prompt.runtime.smart_optimize_desc")}
              </p>
            </div>
            <Switch
              checked={smartOptimizeEnabled}
              onCheckedChange={setSmartOptimizeEnabled}
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => saveRuntimeSettingsMutation.mutate()}
              disabled={saveRuntimeSettingsMutation.isPending}
            >
              {tc("btn.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

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
  )
}
