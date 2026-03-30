import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Document as PdfDocument, Page, pdfjs } from "react-pdf"
import { convertFileSrc } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { getActiveProviderForType } from "@/lib/providers"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { FileCode, FileText, Loader2, Search } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Link } from "react-router-dom"
import type { Document } from "../../packages/types"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

interface SemanticSearchResult {
  chunk_id: string
  document_id: string
  content: string
  score: number
}

interface DisplaySearchResult {
  key: string
  type: "global" | "semantic"
  documentId: string
  snippet: string
  similarity: number
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "md" || ext === "markdown") return FileCode
  return FileText
}

function PdfSearchPreview({ filePath }: { filePath: string }) {
  const [loading, setLoading] = useState(true)
  const fileUrl = useMemo(() => convertFileSrc(filePath), [filePath])

  return (
    <div className="relative h-12 w-10 overflow-hidden rounded-md bg-background">
      {loading ? <Loader2 className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground/50" /> : null}
      <PdfDocument file={fileUrl} loading={null} onLoadSuccess={() => setLoading(false)} onLoadError={() => setLoading(false)}>
        <Page pageNumber={1} width={40} renderAnnotationLayer={false} renderTextLayer={false} />
      </PdfDocument>
    </div>
  )
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildSnippet(content: string, terms: string[]) {
  const normalized = content.replace(/\s+/g, " ").trim()
  if (!normalized) return ""

  const maxLength = 220
  if (terms.length === 0 || normalized.length <= maxLength) {
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
  }

  const lower = normalized.toLowerCase()
  const firstIndex = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0]

  if (firstIndex == null) {
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
  }

  const start = Math.max(0, firstIndex - 60)
  const end = Math.min(normalized.length, start + maxLength)
  const body = normalized.slice(start, end)
  const prefix = start > 0 ? "... " : ""
  const suffix = end < normalized.length ? " ..." : ""
  return `${prefix}${body}${suffix}`
}

function computeGlobalSimilarity(document: Document, normalizedQuery: string, terms: string[]) {
  const title = document.title.toLowerCase()
  const filename = document.filename.toLowerCase()

  let score = 0

  if (title === normalizedQuery) score = Math.max(score, 0.99)
  if (filename === normalizedQuery) score = Math.max(score, 0.97)
  if (title.includes(normalizedQuery)) score = Math.max(score, 0.94)
  if (filename.includes(normalizedQuery)) score = Math.max(score, 0.9)

  const matchedTerms = terms.filter((term) => title.includes(term) || filename.includes(term)).length
  if (matchedTerms === 0) return 0

  score = Math.max(score, 0.75 + Math.min(0.2, matchedTerms * 0.05))
  return Math.min(score, 0.99)
}

function renderHighlightedSnippet(text: string, terms: string[]): ReactNode {
  if (!text) return ""
  if (terms.length === 0) return text

  const sortedTerms = [...new Set(terms)]
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length)

  if (sortedTerms.length === 0) return text

  const tokenPattern = sortedTerms.map((term) => escapeRegExp(term)).join("|")
  const splitRegex = new RegExp(`(${tokenPattern})`, "ig")
  const fullMatchRegex = new RegExp(`^(?:${tokenPattern})$`, "i")

  return text.split(splitRegex).map((part, index) => {
    if (!part) return null
    if (fullMatchRegex.test(part)) {
      return (
        <mark key={`m-${index}`} className="rounded bg-amber-200/80 px-0.5 text-foreground">
          {part}
        </mark>
      )
    }
    return <span key={`t-${index}`}>{part}</span>
  })
}

export default function SearchPage() {
  const { t } = useTranslation("search")
  const { t: tc } = useTranslation("common")
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const [query, setQuery] = useState(initialQuery)
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([])
  const [committedQuery, setCommittedQuery] = useState(initialQuery)
  const { toast } = useToast()

  const { data: libraryDocuments = [] } = useQuery({
    queryKey: ["libraryDocuments"],
    queryFn: api.getLibraryDocuments,
  })

  const documentMap = useMemo(
    () => new Map(libraryDocuments.map((doc) => [doc.id, doc])),
    [libraryDocuments]
  )

  const highlightTerms = useMemo(
    () =>
      committedQuery
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    [committedQuery]
  )

  const normalizedHighlightTerms = useMemo(
    () => highlightTerms.map((term) => term.toLowerCase()),
    [highlightTerms]
  )

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
  })

  const searchMutation = useMutation({
    mutationFn: (data: { query: string; providerId: string }) =>
      api.searchDocuments(data.query, data.providerId, 10),
    onSuccess: (data) => {
      setSemanticResults(data)
    },
    onError: (error: any) => {
      setSemanticResults([])
      toast({
        title: t("toast.search_error.title"),
        description: error.message,
        variant: "destructive",
      })
    },
  })

  const handleSearch = (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim()
    if (!q) {
      toast({
        title: t("toast.empty_query.title"),
        description: t("toast.empty_query.description"),
        variant: "destructive",
      })
      return
    }

    setCommittedQuery(q)

    const activeProvider = getActiveProviderForType(providers, "embed")
    if (!activeProvider) {
      setSemanticResults([])
      toast({
        title: tc("no_active_provider.title"),
        description: "已执行全局搜索；语义搜索需要激活 embedding provider",
      })
      return
    }

    searchMutation.mutate({
      query: q,
      providerId: activeProvider.id,
    })
  }

  // Auto-search when navigated here with ?q= param
  useEffect(() => {
    const q = searchParams.get("q")
    if (q && q.trim()) {
      setQuery(q)
      handleSearch(q)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("q")])

  const handleSubmit = () => {
    if (query.trim()) {
      setSearchParams({ q: query.trim() })
    }
    handleSearch()
  }

  const semanticBestByDocument = useMemo(() => {
    const map = new Map<string, SemanticSearchResult>()
    for (const item of semanticResults) {
      const current = map.get(item.document_id)
      if (!current || item.score > current.score) {
        map.set(item.document_id, item)
      }
    }
    return map
  }, [semanticResults])

  const globalResults = useMemo<DisplaySearchResult[]>(() => {
    const normalizedQuery = committedQuery.trim().toLowerCase()
    if (!normalizedQuery) return []

    const byDocument = new Map<string, DisplaySearchResult>()

    const collected = libraryDocuments.reduce<DisplaySearchResult[]>((acc, document) => {
      const globalScore = computeGlobalSimilarity(document, normalizedQuery, normalizedHighlightTerms)
        if (globalScore <= 0) return acc

        const semanticHit = semanticBestByDocument.get(document.id)
        const snippetSource = semanticHit?.content || `${document.title} ${document.filename}`

        acc.push({
          key: `global-${document.id}`,
          type: "global" as const,
          documentId: document.id,
          similarity: semanticHit ? Math.max(globalScore, semanticHit.score) : globalScore,
          snippet: buildSnippet(snippetSource, highlightTerms),
        })

        return acc
      }, [])

    for (const item of collected) {
      byDocument.set(item.documentId, item)
    }

    // Promote literal content hits from semantic results into global-priority results.
    for (const hit of semanticResults) {
      const contentLower = hit.content.toLowerCase()
      const hasLiteral = normalizedHighlightTerms.some((term) => contentLower.includes(term))
      if (!hasLiteral) continue

      const current = byDocument.get(hit.document_id)
      const nextSimilarity = Math.max(hit.score, 0.86)

      if (!current) {
        byDocument.set(hit.document_id, {
          key: `global-semantic-${hit.chunk_id}`,
          type: "global",
          documentId: hit.document_id,
          similarity: nextSimilarity,
          snippet: buildSnippet(hit.content, highlightTerms),
        })
        continue
      }

      if (nextSimilarity > current.similarity) {
        byDocument.set(hit.document_id, {
          ...current,
          similarity: nextSimilarity,
          snippet: buildSnippet(hit.content, highlightTerms),
        })
      }
    }

    return [...byDocument.values()].sort((a, b) => b.similarity - a.similarity)
  }, [committedQuery, highlightTerms, libraryDocuments, normalizedHighlightTerms, semanticBestByDocument, semanticResults])

  const semanticOnlyResults = useMemo<DisplaySearchResult[]>(() => {
    const excluded = new Set(globalResults.map((item) => item.documentId))
    return semanticResults
      .filter((result) => !excluded.has(result.document_id))
      .map((result) => ({
        key: result.chunk_id,
        type: "semantic" as const,
        documentId: result.document_id,
        similarity: result.score,
        snippet: buildSnippet(result.content, highlightTerms),
      }))
      .sort((a, b) => b.similarity - a.similarity)
  }, [globalResults, highlightTerms, semanticResults])

  const hasAnyResult = globalResults.length > 0 || semanticOnlyResults.length > 0

  const renderResultCard = (result: DisplaySearchResult) => {
    const document = documentMap.get(result.documentId)
    const filename = document?.filename ?? result.documentId
    const isPdf = !!document && filename.toLowerCase().endsWith(".pdf") && !document.is_file_missing
    const Icon = getFileIcon(filename)

    return (
      <Card key={result.key} className="overflow-hidden border-border/70">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="mt-0.5 flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
                {isPdf ? <PdfSearchPreview filePath={document.file_path} /> : <Icon className="h-5 w-5 text-muted-foreground" />}
              </div>

              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-semibold">{filename}</p>
                <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  {renderHighlightedSnippet(result.snippet, highlightTerms)}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <Badge variant="secondary" className="rounded-full">
                {(result.similarity * 100).toFixed(1)}%
              </Badge>
              <Badge variant="outline" className="rounded-full text-[11px]">
                {result.type === "global" ? "全局" : "语义"}
              </Badge>
              <Button asChild size="sm" className="rounded-lg">
                <Link to={`/document/${result.documentId}`}>{t("results.view_document")}</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              placeholder={t("input.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="flex-1"
            />
            <Button onClick={handleSubmit} disabled={searchMutation.isPending}>
              <Search className="mr-2 h-4 w-4" />
              {searchMutation.isPending ? t("btn.searching") : t("btn.search")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasAnyResult && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("results.count", { count: globalResults.length + semanticOnlyResults.length })}
          </p>
          {globalResults.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">全局搜索（高优先级）</p>
              {globalResults.map((result) => renderResultCard(result))}
            </div>
          ) : null}

          {semanticOnlyResults.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">语义搜索</p>
              {semanticOnlyResults.map((result) => renderResultCard(result))}
            </div>
          ) : null}
        </div>
      )}

      {searchMutation.isSuccess && !hasAnyResult && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t("results.no_results")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
