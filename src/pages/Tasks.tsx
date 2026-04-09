import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/hooks/use-toast"
import {
  Clock,
  FileText,
  Languages,
  Database,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Square,
  Trash2,
  Play,
  RefreshCw,
} from "lucide-react"
import { api } from "@/lib/api"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import { useDocumentContextMenu } from "@/hooks/useDocumentContextMenu"

interface UnifiedTask {
  id: string
  documentId: string
  documentTitle: string
  type: "parse" | "translation" | "index"
  status: string
  progress: number
  totalChunks: number
  completedChunks: number
  failedChunks: number
  errorMessage: string | null | undefined
  startedAt: string | null | undefined
  completedAt: string | null | undefined
  createdAt: string
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default"
    case "failed":
      return "destructive"
    case "partial":
      return "destructive"
    case "parsing":
    case "translating":
    case "indexing":
      return "secondary"
    default:
      return "outline"
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />
    case "parsing":
    case "translating":
    case "indexing":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
    case "partial":
      return <AlertCircle className="h-4 w-4 text-yellow-500" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

function TypeIcon({ type }: { type: "parse" | "translation" | "index" }) {
  switch (type) {
    case "parse":
      return <FileText className="h-4 w-4" />
    case "translation":
      return <Languages className="h-4 w-4" />
    case "index":
      return <Database className="h-4 w-4" />
  }
}

function formatDuration(startedAt: string | null | undefined, completedAt: string | null | undefined, now: number): string {
  if (!startedAt) return "-"
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : now
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString()
}

export default function Tasks() {
  const { t } = useTranslation("tasks")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const ctx = useDocumentContextMenu()
  const [now, setNow] = useState(() => Date.now())

  const invalidateTaskQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["parseJobs"] })
    queryClient.invalidateQueries({ queryKey: ["translationJobs"] })
    queryClient.invalidateQueries({ queryKey: ["indexJobs"] })
    queryClient.invalidateQueries({ queryKey: ["documents"] })
  }

  const cancelTaskMutation = useMutation<void, Error, UnifiedTask>({
    mutationFn: async (task) => {
      if (task.type === "parse") {
        await api.cancelParseJob(task.id)
        return
      }
      if (task.type === "translation") {
        await api.cancelTranslationJob(task.id)
        return
      }
      await api.cancelIndexJob(task.documentId)
    },
    onSuccess: (_data, task) => {
      invalidateTaskQueries()
      queryClient.invalidateQueries({ queryKey: ["document", task.documentId] })
    },
    onError: (error) => {
      toast({ title: t("actions.cancelTask"), description: error.message, variant: "destructive" })
    },
  })

  const deleteTaskMutation = useMutation<void, Error, UnifiedTask>({
    mutationFn: async (task) => {
      if (task.type === "parse") {
        await api.deleteParseJob(task.id)
        return
      }
      if (task.type === "translation") {
        await api.deleteTranslationJob(task.id)
        return
      }
      await api.deleteIndexJob(task.id)
    },
    onSuccess: (_data, task) => {
      invalidateTaskQueries()
      queryClient.invalidateQueries({ queryKey: ["document", task.documentId] })
    },
    onError: (error) => {
      toast({ title: t("actions.deleteTask"), description: error.message, variant: "destructive" })
    },
  })

  const resumeMutation = useMutation<unknown, Error, UnifiedTask>({
    mutationFn: async (task) => {
      if (task.type === "translation") {
        return api.resumeTranslationJob(task.id)
      }
      return api.resumeIndexJob(task.id)
    },
    onSuccess: (_data, task) => {
      invalidateTaskQueries()
      queryClient.invalidateQueries({ queryKey: ["document", task.documentId] })
      toast({ title: t("actions.resume"), description: t("actions.resumeStarted") })
    },
    onError: (error) => {
      toast({ title: t("actions.resume"), description: error.message, variant: "destructive" })
    },
  })

  const retryFailedMutation = useMutation<unknown, Error, UnifiedTask>({
    mutationFn: async (task) => {
      if (task.type === "translation") {
        return api.retryFailedTranslationChunks(task.id)
      }
      return api.retryFailedIndexChunks(task.id)
    },
    onSuccess: (_data, task) => {
      invalidateTaskQueries()
      queryClient.invalidateQueries({ queryKey: ["document", task.documentId] })
      toast({ title: t("actions.retryFailed"), description: t("actions.retryStarted") })
    },
    onError: (error) => {
      toast({ title: t("actions.retryFailed"), description: error.message, variant: "destructive" })
    },
  })

  const { data: parseJobs = [] } = useQuery({
    queryKey: ["parseJobs"],
    queryFn: () => api.getAllParseJobs(),
    refetchInterval: 3000,
  })

  const { data: translationJobs = [] } = useQuery({
    queryKey: ["translationJobs"],
    queryFn: () => api.getAllTranslationJobs(),
    refetchInterval: 3000,
  })

  const { data: indexJobs = [] } = useQuery({
    queryKey: ["indexJobs"],
    queryFn: () => api.getAllIndexJobs(),
    refetchInterval: 3000,
  })

  const parseTasks: UnifiedTask[] = parseJobs.map((j) => ({
    id: j.id,
    documentId: j.document_id,
    documentTitle: j.document_title,
    type: "parse" as const,
    status: j.status,
    progress: j.progress,
    totalChunks: 0,
    completedChunks: 0,
    failedChunks: 0,
    errorMessage: j.error_message,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    createdAt: j.created_at,
  }))

  const translationTasks: UnifiedTask[] = translationJobs.map((j) => ({
    id: j.id,
    documentId: j.document_id,
    documentTitle: j.document_title,
    type: "translation" as const,
    status: j.status,
    progress: j.progress,
    totalChunks: j.total_chunks,
    completedChunks: j.completed_chunks,
    failedChunks: j.failed_chunks ?? 0,
    errorMessage: j.error_message,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    createdAt: j.created_at,
  }))

  const indexTasks: UnifiedTask[] = indexJobs.map((j) => ({
    id: j.id,
    documentId: j.document_id,
    documentTitle: j.document_title,
    type: "index" as const,
    status: j.status,
    progress: j.progress,
    totalChunks: j.total_chunks,
    completedChunks: j.completed_chunks,
    failedChunks: 0,
    errorMessage: j.error_message,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    createdAt: j.created_at,
  }))

  const allTasks = [...parseTasks, ...translationTasks, ...indexTasks].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const hasActiveJobs = allTasks.some((t) =>
    ["pending", "parsing", "translating", "indexing"].includes(t.status)
  )

  const hasRunningTasks = allTasks.some((t) =>
    Boolean(t.startedAt) && !t.completedAt && ["parsing", "translating", "indexing"].includes(t.status)
  )

  const activeCount = allTasks.filter((t) =>
    ["pending", "parsing", "translating", "indexing"].includes(t.status)
  ).length

  useEffect(() => {
    if (!hasRunningTasks) return

    setNow(Date.now())
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [hasRunningTasks])

  function renderTaskList(tasks: UnifiedTask[]) {
    if (tasks.length === 0) return null

    return (
      <div className="space-y-3">
        {tasks.map((task) => {
          const isActive = ["pending", "parsing", "translating", "indexing"].includes(task.status)
          const canCancel = task.type === "index"
            ? task.status === "indexing"
            : isActive
          const canDelete = !isActive
          const canResume = (task.status === "partial" || task.status === "failed") && (task.type === "translation" || task.type === "index")
          const canRetryFailed = task.status === "partial" && (task.type === "translation" || task.type === "index")
          const isCancelling = cancelTaskMutation.isPending && cancelTaskMutation.variables?.id === task.id
          const isDeleting = deleteTaskMutation.isPending && deleteTaskMutation.variables?.id === task.id
          const isResuming = resumeMutation.isPending && resumeMutation.variables?.id === task.id
          const isRetrying = retryFailedMutation.isPending && retryFailedMutation.variables?.id === task.id
          const actionsDisabled = isCancelling || isDeleting || isResuming || isRetrying

          return (
          <ContextMenu key={task.id}>
            <ContextMenuTrigger asChild>
            <div
              className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center gap-2 shrink-0">
                <TypeIcon type={task.type} />
                <StatusIcon status={task.status} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium truncate">{task.documentTitle}</span>
                  <Badge variant={statusVariant(task.status)} className="shrink-0">
                    {t(`status.${task.status}`, task.status)}
                  </Badge>
                  <Badge variant="outline" className="shrink-0">
                    {t(`type.${task.type}`)}
                  </Badge>
                </div>

                {(task.status === "parsing" || task.status === "translating" || task.status === "indexing") && (
                  <div className="flex items-center gap-2">
                    <Progress value={task.progress} className="flex-1 h-1.5" />
                    <span className="text-xs text-muted-foreground shrink-0">{Math.round(task.progress)}%</span>
                  </div>
                )}

                {task.status === "partial" && task.totalChunks > 0 && (
                  <p className="text-xs text-yellow-600 mt-1">
                    {t("chunkDetail", {
                      completed: task.completedChunks,
                      total: task.totalChunks,
                      failed: task.failedChunks,
                    })}
                  </p>
                )}

                {task.errorMessage && (
                  <p className="text-xs text-destructive mt-1 truncate" title={task.errorMessage}>
                    {task.errorMessage}
                  </p>
                )}

                <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                  <span>{formatTime(task.createdAt)}</span>
                  <span>{t("columns.duration")}: {formatDuration(task.startedAt, task.completedAt, now)}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/document/${task.documentId}`)}
                  title={t("actions.viewDocument")}
                  disabled={actionsDisabled}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>

                {canResume && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resumeMutation.mutate(task)}
                    title={t("actions.resume")}
                    disabled={actionsDisabled}
                  >
                    {isResuming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </Button>
                )}

                {canRetryFailed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => retryFailedMutation.mutate(task)}
                    title={t("actions.retryFailed")}
                    disabled={actionsDisabled}
                  >
                    {isRetrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                )}

                {canCancel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelTaskMutation.mutate(task)}
                    title={t("actions.cancelTask")}
                    disabled={actionsDisabled}
                  >
                    {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  </Button>
                )}

              {canDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteTaskMutation.mutate(task)}
                  title={t("actions.deleteTask")}
                  disabled={actionsDisabled}
                >
                  {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              )}

              </div>
            </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem onClick={() => navigate(`/document/${task.documentId}`)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("actions.viewDocument")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>{t("contextMenu.copy", "Copy")}</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem onClick={() => ctx.handleCopy(task.id, t("contextMenu.taskId", "Task ID"))}>{t("contextMenu.copyTaskId", "Copy Task ID")}</ContextMenuItem>
                  <ContextMenuItem onClick={() => ctx.handleCopy(task.documentId, t("contextMenu.docId", "Document ID"))}>{t("contextMenu.copyDocId", "Copy Document ID")}</ContextMenuItem>
                  <ContextMenuItem onClick={() => ctx.handleCopy(task.documentTitle, t("contextMenu.docName", "Document Name"))}>{t("contextMenu.copyDocName", "Copy Document Name")}</ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              {(canResume || canRetryFailed || canCancel || canDelete) && <ContextMenuSeparator />}
              {canResume && (
                <ContextMenuItem onClick={() => resumeMutation.mutate(task)}>
                  <Play className="mr-2 h-4 w-4" />
                  {t("actions.resume")}
                </ContextMenuItem>
              )}
              {canRetryFailed && (
                <ContextMenuItem onClick={() => retryFailedMutation.mutate(task)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("actions.retryFailed")}
                </ContextMenuItem>
              )}
              {canCancel && (
                <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => cancelTaskMutation.mutate(task)}>
                  <Square className="mr-2 h-4 w-4" />
                  {t("actions.cancelTask")}
                </ContextMenuItem>
              )}
              {canDelete && (
                <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteTaskMutation.mutate(task)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("actions.deleteTask")}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
          )
        })}
      </div>
    )
  }

  function renderEmpty(section: "all" | "parsing" | "translation" | "indexing") {
    const titleKey = `empty.${section}.title` as const
    const descKey = `empty.${section}.description` as const
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Clock className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t(titleKey)}</h3>
        <p className="text-sm text-muted-foreground">
          {t(descKey)}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {hasActiveJobs && (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {activeCount}
          </Badge>
        )}
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList>
          <TabsTrigger value="all">
            {t("tabs.all")}
            {allTasks.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">({allTasks.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="parsing">
            {t("tabs.parsing")}
            {parseTasks.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">({parseTasks.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="translation">
            {t("tabs.translation")}
            {translationTasks.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">({translationTasks.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="indexing">
            {t("tabs.indexing")}
            {indexTasks.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">({indexTasks.length})</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabs.all")}</CardTitle>
            </CardHeader>
            <CardContent>
              {allTasks.length > 0 ? renderTaskList(allTasks) : renderEmpty("all")}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parsing">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabs.parsing")}</CardTitle>
            </CardHeader>
            <CardContent>
              {parseTasks.length > 0 ? renderTaskList(parseTasks) : renderEmpty("parsing")}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="translation">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabs.translation")}</CardTitle>
            </CardHeader>
            <CardContent>
              {translationTasks.length > 0 ? renderTaskList(translationTasks) : renderEmpty("translation")}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="indexing">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabs.indexing")}</CardTitle>
            </CardHeader>
            <CardContent>
              {indexTasks.length > 0 ? renderTaskList(indexTasks) : renderEmpty("indexing")}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
