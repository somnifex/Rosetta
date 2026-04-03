import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileText, Clock, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"
import type { Document } from "../../packages/types"
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
import { RenameDialog } from "@/components/library/RenameDialog"
export default function Dashboard() {
  const { t } = useTranslation("dashboard")
  const { t: tc } = useTranslation("common")
  const { t: tl } = useTranslation("library")
  const ctx = useDocumentContextMenu()
  const [renameDoc, setRenameDoc] = useState<Document | null>(null)

  const { data: documents } = useQuery({
    queryKey: ["documents"],
    queryFn: api.getDocuments,
  })

  const stats = {
    total: documents?.length || 0,
    parsing: documents?.filter((d) => d.parse_status === "parsing").length || 0,
    completed: documents?.filter((d) => d.parse_status === "completed").length || 0,
    failed: documents?.filter((d) => d.parse_status === "failed").length || 0,
  }

  const recentDocuments = documents?.slice(0, 5) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.total")}</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("stats.total_desc")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.parsing")}</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.parsing}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("stats.parsing_desc")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.completed")}</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("stats.completed_desc")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.failed")}</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("stats.failed_desc")}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("recent.title")}</CardTitle>
          <CardDescription>{t("recent.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {recentDocuments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">{t("empty.title")}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t("empty.description")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {recentDocuments.map((doc) => (
                <ContextMenu key={doc.id}>
                  <ContextMenuTrigger asChild>
                    <Link
                      to={`/document/${doc.id}`}
                      className="flex items-center justify-between border-b pb-4 last:border-0 hover:bg-accent/50 -mx-2 px-2 py-2 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{doc.title}</p>
                          <p className="text-sm text-muted-foreground">{doc.filename}</p>
                        </div>
                      </div>
                      <Badge variant={
                        doc.parse_status === "completed" ? "default" :
                        doc.parse_status === "parsing" ? "secondary" :
                        doc.parse_status === "failed" ? "destructive" : "outline"
                      }>
                        {doc.parse_status === "parsing" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {tc(`status.${doc.parse_status as "pending" | "parsing" | "completed" | "failed"}`)}
                      </Badge>
                    </Link>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem asChild>
                      <Link to={`/document/${doc.id}`}>{tl("context_menu.open")}</Link>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => ctx.revealMutation.mutate(doc.id)}>{tl("context_menu.reveal")}</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => setRenameDoc(doc as Document)}>{tl("context_menu.rename")}</ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>{tl("context_menu.copy")}</ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuItem onClick={() => ctx.handleCopy(doc.title, tl("copy_labels.document_name"))}>{tl("context_menu.copy_name")}</ContextMenuItem>
                        <ContextMenuItem onClick={() => ctx.handleCopy(doc.id, tl("copy_labels.document_id"))}>{tl("context_menu.copy_id")}</ContextMenuItem>
                        <ContextMenuItem onClick={() => ctx.handleCopyPath(doc.id)}>{tl("context_menu.copy_path")}</ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onClick={() => ctx.duplicateMutation.mutate(doc.id)}>{tl("context_menu.duplicate")}</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => ctx.trashMutation.mutate([doc.id])}>{tl("context_menu.move_to_trash")}</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      <RenameDialog
        open={!!renameDoc}
        document={renameDoc}
        onOpenChange={(o) => (!o ? setRenameDoc(null) : undefined)}
        onConfirm={(id, title) => ctx.renameMutation.mutate({ id, title })}
      />
    </div>
  )
}
