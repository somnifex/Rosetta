import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Upload, FileText, FileCode, FileType, ChevronDown } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { useToast } from "@/hooks/use-toast"

const FILE_TYPES = [
  { type: "pdf", label: "PDF (.pdf)", extensions: ["pdf"], icon: FileText },
  { type: "md", label: "Markdown (.md)", extensions: ["md", "markdown"], icon: FileCode },
  { type: "txt", label: "Text (.txt)", extensions: ["txt"], icon: FileType },
] as const

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
      toast({
        title: t("toast.import_success.title"),
        description: t("toast.import_success.description"),
      })
    },
    onError: (error: any) => {
      toast({
        title: t("toast.import_error.title"),
        description: error.message || t("toast.import_error.description"),
        variant: "destructive",
      })
    },
  })

  const handleImport = async (fileType: string, extensions: readonly string[]) => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: fileType.toUpperCase(), extensions: [...extensions] }],
      })

      if (selected) {
        const files = Array.isArray(selected) ? selected : [selected]
        for (const file of files) {
          await importMutation.mutateAsync({ filePath: file, fileType })
        }
      }
    } catch (error) {
      console.error("Import error:", error)
    }
  }

  const handleImportAll = async () => {
    try {
      const allExtensions = FILE_TYPES.flatMap((ft) => [...ft.extensions])
      const selected = await open({
        multiple: true,
        filters: [{ name: "Documents", extensions: allExtensions }],
      })

      if (selected) {
        const files = Array.isArray(selected) ? selected : [selected]
        for (const file of files) {
          const ext = file.split(".").pop()?.toLowerCase() || ""
          const ft = FILE_TYPES.find((f) => f.extensions.some((supportedExt) => supportedExt === ext))
          const fileType = ft?.type || "pdf"
          await importMutation.mutateAsync({ filePath: file, fileType })
        }
      }
    } catch (error) {
      console.error("Import error:", error)
    }
  }

  return (
    <div className="flex items-center">
      <Button
        onClick={handleImportAll}
        disabled={importMutation.isPending}
        className="rounded-l-lg rounded-r-none shadow-none"
      >
        <Upload className="mr-2 h-4 w-4" />
        {importMutation.isPending ? t("btn.importing") : t("btn.import")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={importMutation.isPending}
            className="rounded-l-none rounded-r-lg border-l border-primary-foreground/20 px-2.5 shadow-none"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {FILE_TYPES.map(({ type, label, extensions, icon: Icon }) => (
            <DropdownMenuItem key={type} onClick={() => handleImport(type, extensions)} className="gap-2.5">
              <Icon className="h-4 w-4 text-muted-foreground" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
