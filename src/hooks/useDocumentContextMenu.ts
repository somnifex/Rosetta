import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

export function useDocumentContextMenu() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation("library")

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.getCategories })
  const { data: folders = [] } = useQuery({ queryKey: ["folders"], queryFn: api.getFolders })

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["libraryDocuments"] })
    queryClient.invalidateQueries({ queryKey: ["documents"] })
  }

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.duplicateDocument(id),
    onSuccess: () => {
      invalidateQueries()
      toast({ title: t("toast.duplicate_success") })
    },
    onError: (error: Error) =>
      toast({ title: t("toast.duplicate_error"), description: error.message, variant: "destructive" }),
  })

  const revealMutation = useMutation({
    mutationFn: async (id: string) => {
      const path = await api.getDocumentFilePath(id)
      await api.revealInOs(path)
    },
    onError: (error: Error) =>
      toast({ title: t("toast.reveal_error"), description: error.message, variant: "destructive" }),
  })
  
  const moveMutation = useMutation({
    mutationFn: (data: { documentId: string, categoryId?: string, folderId?: string }) => 
      api.batchUpdateDocuments({ documentIds: [data.documentId], categoryId: data.categoryId, folderId: data.folderId }),
    onSuccess: () => invalidateQueries(),
    onError: (error: Error) =>
      toast({ title: t("toast.move_error"), description: error.message, variant: "destructive" }),
  })

  const renameMutation = useMutation({
    mutationFn: (data: { id: string, title: string }) => api.updateDocument({ id: data.id, title: data.title }),
    onSuccess: () => {
      invalidateQueries()
      toast({ title: t("toast.rename_success") })
    },
    onError: (error: Error) =>
      toast({ title: t("toast.rename_error"), description: error.message, variant: "destructive" }),
  })

  const trashMutation = useMutation({
    mutationFn: (ids: string[]) => api.moveDocumentsToTrash(ids),
    onSuccess: () => {
      invalidateQueries()
      toast({ title: t("toast.trash_success") })
    },
    onError: (error: Error) =>
      toast({ title: t("toast.trash_error"), description: error.message, variant: "destructive" }),
  })

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: t("toast.copy_success", { label }) })
    } catch {
      toast({ title: t("toast.copy_error", { label }), variant: "destructive" })
    }
  }

  const handleCopyPath = async (id: string) => {
    try {
      const path = await api.getDocumentFilePath(id)
      await handleCopy(path, t("copy_labels.file_path"))
    } catch {
      toast({ title: t("toast.copy_path_error"), variant: "destructive" })
    }
  }

  return {
    categories,
    folders,
    duplicateMutation,
    revealMutation,
    moveMutation,
    renameMutation,
    trashMutation,
    handleCopy,
    handleCopyPath
  }
}
