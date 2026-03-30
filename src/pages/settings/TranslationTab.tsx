import { useState, useCallback, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { channelStore, type TranslatePromptConfig, DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RotateCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function TranslationTab() {
  const { t } = useTranslation("settings")
  const { toast } = useToast()

  const [translatePrompt, setTranslatePrompt] = useState<TranslatePromptConfig>(
    () => channelStore.getTranslatePrompt()
  )

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

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

  return (
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
  )
}
