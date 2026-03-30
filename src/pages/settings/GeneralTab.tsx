import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { loadChatBehaviorSettings } from "@/lib/chat"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

export default function GeneralTab() {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [loaded, setLoaded] = useState(false)
  const [modelBehaviorDescription, setModelBehaviorDescription] = useState("")
  const [documentAppendPrompt, setDocumentAppendPrompt] = useState("")
  const [longTextRagPrompt, setLongTextRagPrompt] = useState("")
  const [longTextThreshold, setLongTextThreshold] = useState("3000")
  const [defaultAlwaysIncludeFullDocument, setDefaultAlwaysIncludeFullDocument] =
    useState(false)

  const { data: appSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: api.getAllAppSettings,
  })

  useEffect(() => {
    if (loaded || !appSettings) return

    loadChatBehaviorSettings()
      .then((settings) => {
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

      <Card>
        <CardHeader>
          <CardTitle>{t("general.chat_behavior_title")}</CardTitle>
          <CardDescription>{t("general.chat_behavior_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("general.model_behavior_description")}</Label>
            <textarea
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
              checked={defaultAlwaysIncludeFullDocument}
              onCheckedChange={setDefaultAlwaysIncludeFullDocument}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("general.long_text_threshold")}</Label>
            <Input
              type="number"
              min="400"
              value={longTextThreshold}
              onChange={(event) => setLongTextThreshold(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("general.document_append_prompt")}</Label>
            <textarea
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
