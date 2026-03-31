import { useState } from "react"
import { useTranslation } from "react-i18next"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FolderOpen } from "lucide-react"

interface BatchExportDialogProps {
  open: boolean
  onConfirm: (format: string, contentType: string, outputDir: string) => void
  onClose: () => void
}

export function BatchExportDialog({
  open: isOpen,
  onConfirm,
  onClose,
}: BatchExportDialogProps) {
  const { t } = useTranslation("library")
  const [contentType, setContentType] = useState("original")
  const [format, setFormat] = useState("md")
  const [outputDir, setOutputDir] = useState("")

  const handleChooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected && typeof selected === "string") {
      setOutputDir(selected)
    }
  }

  const handleConfirm = () => {
    onConfirm(format, contentType, outputDir)
    setContentType("original")
    setFormat("md")
    setOutputDir("")
    onClose()
  }

  const handleClose = () => {
    setContentType("original")
    setFormat("md")
    setOutputDir("")
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("batch.export_dialog_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("batch.export_content_type")}</label>
            <div className="flex gap-2">
              {(["original", "translated", "bilingual"] as const).map((ct) => (
                <button
                  key={ct}
                  type="button"
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    contentType === ct
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent"
                  }`}
                  onClick={() => setContentType(ct)}
                >
                  {t(`batch.export_${ct}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("batch.export_format")}</label>
            <div className="flex gap-2">
              {(["md", "txt"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    format === f
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent"
                  }`}
                  onClick={() => setFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("batch.export_choose_folder")}</label>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={handleChooseFolder}>
              <FolderOpen className="h-4 w-4" />
              <span className="truncate">{outputDir || t("batch.export_choose_folder")}</span>
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t("batch.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!outputDir}>
            {t("batch.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
