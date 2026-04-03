import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ExtractionTemplate, ExtractionTemplateInput } from "../../../packages/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

interface ExtractionTemplateDialogProps {
  open: boolean
  template?: ExtractionTemplate | null
  loading?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: ExtractionTemplateInput) => void
}

function emptyForm(): ExtractionTemplateInput {
  return {
    name: "",
    fieldKey: "",
    description: "",
    systemPrompt: "",
    userPrompt: "{{document_text}}",
    isEnabled: true,
  }
}

export function ExtractionTemplateDialog({
  open,
  template,
  loading = false,
  onOpenChange,
  onSubmit,
}: ExtractionTemplateDialogProps) {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const [form, setForm] = useState<ExtractionTemplateInput>(emptyForm())

  useEffect(() => {
    if (!open) {
      setForm(emptyForm())
      return
    }

    if (!template) {
      setForm(emptyForm())
      return
    }

    setForm({
      name: template.name,
      fieldKey: template.field_key,
      description: template.description || "",
      systemPrompt: template.system_prompt,
      userPrompt: template.user_prompt,
      isEnabled: template.is_enabled,
    })
  }, [open, template])

  const canSubmit =
    form.name.trim() &&
    form.fieldKey.trim() &&
    form.systemPrompt.trim() &&
    form.userPrompt.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>
            {template
              ? t("extraction.dialog.edit_title")
              : t("extraction.dialog.create_title")}
          </DialogTitle>
          <DialogDescription>
            {t("extraction.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("extraction.dialog.name")}</label>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder={t("extraction.dialog.name_placeholder")}
                className="rounded-lg"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("extraction.dialog.field_key")}</label>
              <Input
                value={form.fieldKey}
                onChange={(event) =>
                  setForm((current) => ({ ...current, fieldKey: event.target.value }))
                }
                placeholder={t("extraction.dialog.field_key_placeholder")}
                className="rounded-lg font-mono"
                disabled={!!template}
              />
              <p className="text-xs text-muted-foreground">
                {template
                  ? t("extraction.dialog.field_key_locked")
                  : t("extraction.dialog.field_key_hint")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t("extraction.dialog.description_label")}</label>
            <Input
              value={form.description || ""}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t("extraction.dialog.description_placeholder")}
              className="rounded-lg"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t("extraction.dialog.system_prompt")}</label>
            <textarea
              value={form.systemPrompt}
              onChange={(event) =>
                setForm((current) => ({ ...current, systemPrompt: event.target.value }))
              }
              rows={5}
              className="min-h-[120px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t("extraction.dialog.user_prompt")}</label>
            <textarea
              value={form.userPrompt}
              onChange={(event) =>
                setForm((current) => ({ ...current, userPrompt: event.target.value }))
              }
              rows={6}
              className="min-h-[150px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <p className="text-xs text-muted-foreground">
              {t("extraction.dialog.user_prompt_hint")}
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">{t("extraction.dialog.enabled_title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("extraction.dialog.enabled_description")}
              </p>
            </div>
            <Switch
              checked={form.isEnabled ?? true}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, isEnabled: checked }))
              }
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 sm:gap-2">
          <Button
            variant="outline"
            className="rounded-lg shadow-none"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {tc("btn.cancel")}
          </Button>
          <Button
            className="rounded-lg shadow-none"
            disabled={loading || !canSubmit}
            onClick={() =>
              onSubmit({
                ...form,
                name: form.name.trim(),
                fieldKey: form.fieldKey.trim(),
                description: form.description?.trim() || "",
                systemPrompt: form.systemPrompt.trim(),
                userPrompt: form.userPrompt.trim(),
              })
            }
          >
            {tc("btn.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
