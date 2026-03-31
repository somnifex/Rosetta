import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const LANGUAGES = [
  "English",
  "Chinese",
  "Japanese",
  "Korean",
  "French",
  "German",
  "Spanish",
  "Portuguese",
  "Russian",
  "Arabic",
  "Italian",
  "Dutch",
  "Turkish",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Hindi",
  "Polish",
]

interface BatchLanguageDialogProps {
  open: boolean
  onConfirm: (sourceLanguage?: string, targetLanguage?: string) => void
  onClose: () => void
}

export function BatchLanguageDialog({
  open,
  onConfirm,
  onClose,
}: BatchLanguageDialogProps) {
  const { t } = useTranslation("library")
  const [sourceLang, setSourceLang] = useState<string>("")
  const [targetLang, setTargetLang] = useState<string>("")

  const handleConfirm = () => {
    onConfirm(sourceLang || undefined, targetLang || undefined)
    setSourceLang("")
    setTargetLang("")
    onClose()
  }

  const handleClose = () => {
    setSourceLang("")
    setTargetLang("")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("batch.language_dialog_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("batch.source_language")}</label>
            <Select value={sourceLang} onValueChange={setSourceLang}>
              <SelectTrigger>
                <SelectValue placeholder={t("batch.language_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("batch.target_language")}</label>
            <Select value={targetLang} onValueChange={setTargetLang}>
              <SelectTrigger>
                <SelectValue placeholder={t("batch.language_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t("batch.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!sourceLang && !targetLang}>
            {t("batch.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
