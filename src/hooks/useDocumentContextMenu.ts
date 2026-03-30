import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

export function useDocumentContextMenu() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

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
      toast({ title: "文档已创建副本" })
    },
    onError: (error: Error) => toast({ title: "创建副本失败", description: error.message, variant: "destructive" }),
  })

  const revealMutation = useMutation({
    mutationFn: async (id: string) => {
      const path = await api.getDocumentFilePath(id)
      await api.revealInOs(path)
    },
    onError: (error: Error) => toast({ title: "定位失败", description: error.message, variant: "destructive" }),
  })
  
  const moveMutation = useMutation({
    mutationFn: (data: { documentId: string, categoryId?: string, folderId?: string }) => 
      api.batchUpdateDocuments({ documentIds: [data.documentId], categoryId: data.categoryId, folderId: data.folderId }),
    onSuccess: () => invalidateQueries(),
    onError: (error: Error) => toast({ title: "移动失败", description: error.message, variant: "destructive" }),
  })

  const renameMutation = useMutation({
    mutationFn: (data: { id: string, title: string }) => api.updateDocument({ id: data.id, title: data.title }),
    onSuccess: () => {
      invalidateQueries()
      toast({ title: "重命名成功" })
    },
    onError: (error: Error) => toast({ title: "重命名失败", description: error.message, variant: "destructive" }),
  })

  const trashMutation = useMutation({
    mutationFn: (ids: string[]) => api.moveDocumentsToTrash(ids),
    onSuccess: () => {
      invalidateQueries()
      toast({ title: "已移入回收站" })
    },
    onError: (error: Error) => toast({ title: "删除失败", description: error.message, variant: "destructive" }),
  })

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `已复制${label}` })
    } catch {
      toast({ title: `复制${label}失败`, variant: "destructive" })
    }
  }

  const handleCopyPath = async (id: string) => {
    try {
      const path = await api.getDocumentFilePath(id)
      await handleCopy(path, "物理路径")
    } catch {
      toast({ title: "获取路径失败", variant: "destructive" })
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
