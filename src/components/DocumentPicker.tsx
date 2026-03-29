import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { open } from "@tauri-apps/plugin-dialog"
import type { Document } from "../../packages/types"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Upload, FileText, Check } from "lucide-react"
import type { ChatAttachment } from "@/lib/chat"

interface DocumentPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (attachments: ChatAttachment[]) => void
  existingAttachments?: ChatAttachment[]
}

export function DocumentPicker({
  open: isOpen,
  onOpenChange,
  onConfirm,
  existingAttachments = [],
}: DocumentPickerProps) {
  const { t } = useTranslation("chat")
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Map<string, ChatAttachment>>(
    () => new Map(existingAttachments.map((a) => [a.documentId, a]))
  )
  const [uploading, setUploading] = useState(false)

  const { data: documents } = useQuery({
    queryKey: ["documents"],
    queryFn: api.getDocuments,
    enabled: isOpen,
  })

  const importMutation = useMutation({
    mutationFn: api.importPdf,
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      setSelected((prev) => {
        const next = new Map(prev)
        next.set(doc.id, {
          documentId: doc.id,
          title: doc.title,
          filename: doc.filename,
        })
        return next
      })
    },
  })

  const filtered = documents?.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.filename.toLowerCase().includes(search.toLowerCase())
  ) || []

  const toggleDoc = (doc: Document) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(doc.id)) {
        next.delete(doc.id)
      } else {
        next.set(doc.id, {
          documentId: doc.id,
          title: doc.title,
          filename: doc.filename,
        })
      }
      return next
    })
  }

  const handleUpload = async () => {
    try {
      const result = await open({
        multiple: true,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      })
      if (result) {
        setUploading(true)
        const files = Array.isArray(result) ? result : [result]
        for (const file of files) {
          await importMutation.mutateAsync(file)
        }
        setUploading(false)
      }
    } catch {
      setUploading(false)
    }
  }

  const handleConfirm = () => {
    onConfirm(Array.from(selected.values()))
    onOpenChange(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("picker.title")}</DialogTitle>
          <DialogDescription>{t("picker.description")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="library" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="w-full">
            <TabsTrigger value="library" className="flex-1">
              {t("picker.library_tab")}
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1">
              {t("picker.upload_tab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="flex-1 min-h-0 flex flex-col gap-3 mt-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("picker.search_placeholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex-1 overflow-auto min-h-0 max-h-[40vh] space-y-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {t("picker.no_documents")}
                </p>
              ) : (
                filtered.map((doc) => {
                  const isSelected = selected.has(doc.id)
                  return (
                    <button
                      key={doc.id}
                      onClick={() => toggleDoc(doc)}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-accent border border-transparent"
                      }`}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{doc.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {doc.filename}
                        </p>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="upload" className="mt-3">
            <div className="flex flex-col items-center gap-4 py-8 border-2 border-dashed rounded-lg">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t("picker.upload_hint")}
              </p>
              <Button
                onClick={handleUpload}
                disabled={uploading}
                variant="outline"
              >
                {uploading ? t("picker.uploading") : t("picker.upload_btn")}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between pt-2 border-t">
          {selected.size > 0 && (
            <Badge variant="secondary">
              {t("picker.selected", { count: selected.size })}
            </Badge>
          )}
          <div className="flex-1" />
          <Button onClick={handleConfirm} disabled={selected.size === 0}>
            {t("picker.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
