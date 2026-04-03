import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Upload } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { useToast } from "@/hooks/use-toast"

const SUPPORTED_EXTENSIONS = ["pdf", "md", "markdown", "txt"]

function detectFileType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  if (ext === "markdown") return "md"
  if (SUPPORTED_EXTENSIONS.includes(ext)) return ext
  return "pdf" // fallback
}

export function ImportButton() {
  const { t } = useTranslation("library")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const importMutation = useMutation({
    mutationFn: ({ filePath, fileType }: { filePath: string; fileType: string }) =>
      api.importDocument(filePath, fileType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["libraryDocuments"] })
    },
    onError: (error: any) => {
      toast({
        title: t("toast.import_error.title"),
        description: error.message || t("toast.import_error.description"),
        variant: "destructive",
      })
    },
  })

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Documents", extensions: [...SUPPORTED_EXTENSIONS] }],
      })

      if (!selected) return

      const files = Array.isArray(selected) ? selected : [selected]
      let successCount = 0
      const errors: string[] = []

      for (const file of files) {
        const fileType = detectFileType(file)
        try {
          await importMutation.mutateAsync({ filePath: file, fileType })
          successCount++
        } catch (error: any) {
          errors.push(error?.message || String(error))
        }
      }

      if (successCount > 0) {
        toast({
          title: t("toast.import_success.title"),
          description: successCount > 1
            ? t("toast.import_success.description_many", { count: successCount })
            : t("toast.import_success.description"),
        })
      }
      if (errors.length > 0 && successCount > 0) {
        toast({
          title: t("toast.import_partial.title"),
          description: t("toast.import_partial.description", { count: errors.length }),
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Import error:", error)
    }
  }

  return (
    <Button
      onClick={handleImport}
      disabled={importMutation.isPending}
      className="gap-2 rounded-lg shadow-none"
    >
      <Upload className="h-4 w-4" />
      {importMutation.isPending ? t("btn.importing") : t("btn.import")}
    </Button>
  )
}
