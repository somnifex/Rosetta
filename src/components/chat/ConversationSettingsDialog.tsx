import type { LlmSamplingConfig } from "../../../packages/types"
import type { ChatConversation } from "@/lib/chat"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "react-i18next"

interface ConversationSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversation: ChatConversation | null
  activeModelLabel?: string
  onChange: (updates: Partial<ChatConversation>) => void
}

function cleanupSamplingConfig(sampling: LlmSamplingConfig): LlmSamplingConfig | undefined {
  if (
    sampling.temperature == null &&
    sampling.top_p == null &&
    sampling.top_k == null &&
    sampling.max_tokens == null
  ) {
    return undefined
  }

  return sampling
}

export function ConversationSettingsDialog({
  open,
  onOpenChange,
  conversation,
  activeModelLabel,
  onChange,
}: ConversationSettingsDialogProps) {
  const { t } = useTranslation("chat")

  const sampling = conversation?.sampling

  const updateSampling = (
    key: keyof LlmSamplingConfig,
    rawValue: string,
    options?: { integer?: boolean }
  ) => {
    if (!conversation) return

    const nextValue = rawValue.trim()
    const parsed =
      nextValue === ""
        ? undefined
        : options?.integer
          ? Number.parseInt(nextValue, 10)
          : Number(nextValue)

    if (parsed != null && !Number.isFinite(parsed)) {
      return
    }

    const nextSampling = cleanupSamplingConfig({
      temperature: sampling?.temperature,
      top_p: sampling?.top_p,
      top_k: sampling?.top_k,
      max_tokens: sampling?.max_tokens,
      [key]: parsed,
    })

    onChange({ sampling: nextSampling })
  }

  const updateRetrievalTopK = (rawValue: string) => {
    if (!conversation) return
    const nextValue = rawValue.trim()
    if (!nextValue) {
      onChange({ retrievalTopK: undefined })
      return
    }

    const parsed = Number.parseInt(nextValue, 10)
    if (!Number.isFinite(parsed)) return
    onChange({ retrievalTopK: Math.min(12, Math.max(1, parsed)) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[28px] border-border/60 bg-background/95 p-0 shadow-[0_32px_80px_rgba(15,23,42,0.22)] backdrop-blur">
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full bg-background/80">
              {conversation?.scope === "document"
                ? t("scope.document")
                : t("scope.general")}
            </Badge>
            {activeModelLabel ? (
              <Badge variant="outline" className="rounded-full bg-background/80">
                {t("settings.active_model", { model: activeModelLabel })}
              </Badge>
            ) : null}
          </div>
        </DialogHeader>

        <div className="grid gap-6 px-6 py-5">
          <div className="grid gap-2">
            <Label htmlFor="conversation-system-prompt">
              {t("settings.system_prompt")}
            </Label>
            <textarea
              id="conversation-system-prompt"
              value={conversation?.systemPrompt ?? ""}
              onChange={(event) =>
                onChange({
                  systemPrompt: event.target.value.trim() || undefined,
                })
              }
              rows={6}
              placeholder={t("settings.system_prompt_placeholder")}
              className="min-h-[140px] w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 text-sm leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.system_prompt_hint")}
            </p>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("settings.model_params")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.model_params_hint")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() =>
                  onChange({
                    systemPrompt: undefined,
                    sampling: undefined,
                    retrievalTopK: undefined,
                    alwaysIncludeFullDocument: undefined,
                  })
                }
              >
                {t("settings.reset")}
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-border/70 px-3 py-2">
              <div>
                <p className="text-sm font-medium">{t("settings.always_include_full_document")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.always_include_full_document_hint")}
                </p>
              </div>
              <Switch
                checked={conversation?.alwaysIncludeFullDocument === true}
                onCheckedChange={(checked) => onChange({ alwaysIncludeFullDocument: checked })}
                disabled={conversation?.scope !== "document"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="conversation-temperature">Temperature</Label>
                <Input
                  id="conversation-temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={sampling?.temperature?.toString() ?? ""}
                  onChange={(event) =>
                    updateSampling("temperature", event.target.value)
                  }
                  placeholder={t("settings.inherit_global")}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="conversation-top-p">Top P</Label>
                <Input
                  id="conversation-top-p"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={sampling?.top_p?.toString() ?? ""}
                  onChange={(event) => updateSampling("top_p", event.target.value)}
                  placeholder={t("settings.inherit_global")}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="conversation-top-k">Top K</Label>
                <Input
                  id="conversation-top-k"
                  type="number"
                  step="1"
                  min="1"
                  value={sampling?.top_k?.toString() ?? ""}
                  onChange={(event) =>
                    updateSampling("top_k", event.target.value, { integer: true })
                  }
                  placeholder={t("settings.inherit_global")}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="conversation-max-tokens">Max Tokens</Label>
                <Input
                  id="conversation-max-tokens"
                  type="number"
                  step="1"
                  min="1"
                  value={sampling?.max_tokens?.toString() ?? ""}
                  onChange={(event) =>
                    updateSampling("max_tokens", event.target.value, {
                      integer: true,
                    })
                  }
                  placeholder={t("settings.inherit_global")}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="conversation-retrieval-top-k">
                  {t("settings.retrieval_top_k")}
                </Label>
                <Input
                  id="conversation-retrieval-top-k"
                  type="number"
                  step="1"
                  min="1"
                  max="12"
                  value={conversation?.retrievalTopK?.toString() ?? ""}
                  onChange={(event) => updateRetrievalTopK(event.target.value)}
                  placeholder="6"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border/60 px-6 py-4">
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
          >
            {t("settings.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
