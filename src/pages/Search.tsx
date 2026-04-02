import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
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
import { FileCode, FileText, Loader2, Search, Settings2, SlidersHorizontal } from "lucide-react"
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
  type: "global" | "semantic" | "setting"
  title: string
  snippet: string
  similarity: number
  documentId?: string
  settingKey?: string
}

interface SearchOptions {
  includeDocuments: boolean
  includeSettings: boolean
  includeSemantic: boolean
  priority: "global-first" | "semantic-first"
  maxGlobalResults: number
  maxSemanticResults: number
  minSemanticScore: number
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  includeDocuments: true,
  includeSettings: true,
  includeSemantic: true,
  priority: "global-first",
  maxGlobalResults: 12,
  maxSemanticResults: 12,
  minSemanticScore: 0.35,
}

const SETTING_LABEL_BY_KEY: Record<string, string> = {
  "general.default_target_language": "general.default_target_language",
  "general.theme": "general.theme",
  "chat.model_behavior_description": "general.model_behavior_description",
  "chat.long_text_threshold": "general.long_text_threshold",
  "chat.default_always_include_full_document": "general.default_full_document",
  "chat.prompt.document_append": "general.document_append_prompt",
  "chat.prompt.long_text_rag": "general.long_text_rag_prompt",
  "translation.chunk_size": "prompt.runtime.chunk_size",
  "translation.chunk_overlap": "prompt.runtime.chunk_overlap",
  "translation.max_concurrent_requests": "prompt.runtime.max_concurrent_requests",
  "translation.max_requests_per_minute": "prompt.runtime.max_requests_per_minute",
  "translation.smart_optimize_enabled": "prompt.runtime.smart_optimize",
  "llm.failover_enabled": "providers.failover.label",
  "logs.level": "logs.level",
  "logs.retention_days": "logs.retention_days",
  "mineru.mode": "mineru.mode_label",
  "mineru.python_path": "mineru.builtin.python_path_label",
  "mineru.port": "mineru.builtin.port_label",
  "mineru.auto_start": "mineru.builtin.auto_start_label",
  "mineru.external_url": "mineru.url_label",
  "mineru.use_venv": "mineru.venv.use_venv_label",
  "mineru.clone_url": "mineru.venv.clone_url_label",
  "mineru.pip_index_url": "mineru.venv.pip_index_url_label",
  "mineru.install_method": "mineru.venv.install_method_label",
  "mineru.model_source": "mineru.models.source_label",
  "mineru.models_dir": "mineru.models.dir_label",
  "rag.chunk_size": "rag.chunk_size",
  "rag.chunk_overlap": "rag.chunk_overlap",
  "rag.vector_backend": "rag.backend_label",
  "rag.zvec_python_path": "rag.zvec_python_path",
  "rag.zvec_collections_dir": "rag.zvec_collections_dir",
  "rag.zvec_use_venv": "rag.zvec_venv.use_venv_label",
  "rag.zvec_system_python": "rag.zvec_venv.system_python_label",
  "rag.zvec_pip_index_url": "rag.zvec_venv.pip_index_url_label",
  "rag.reranker_mode": "rag.reranker.mode_label",
  "rag.reranker_top_n": "rag.reranker.top_n",
}

const SETTING_GROUP_BY_PREFIX: Record<string, string> = {
  general: "tabs.general",
  chat: "tabs.general",
  translation: "tabs.translation",
  providers: "tabs.providers",
  llm: "tabs.providers",
  mineru: "tabs.mineru",
  webdav: "tabs.webdav",
  rag: "tabs.rag",
  logs: "tabs.logs",
}

const SETTING_TAB_BY_PREFIX: Record<string, string> = {
  general: "general",
  chat: "general",
  translation: "translation",
  providers: "providers",
  llm: "providers",
  mineru: "mineru",
  webdav: "webdav",
  rag: "rag",
  logs: "logs",
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

function computeSettingSimilarity(
  key: string,
  value: string,
  localizedLabel: string,
  normalizedQuery: string,
  terms: string[]
) {
  const keyLower = key.toLowerCase()
  const valueLower = value.toLowerCase()
  const labelLower = localizedLabel.toLowerCase()

  let score = 0
  if (keyLower === normalizedQuery) score = Math.max(score, 0.99)
  if (keyLower.includes(normalizedQuery)) score = Math.max(score, 0.94)
  if (valueLower.includes(normalizedQuery)) score = Math.max(score, 0.88)
  if (labelLower.includes(normalizedQuery)) score = Math.max(score, 0.93)

  const matchedTerms = terms.filter(
    (term) => keyLower.includes(term) || valueLower.includes(term) || labelLower.includes(term)
  ).length
  if (matchedTerms === 0 && score <= 0) return 0

  score = Math.max(score, 0.72 + Math.min(0.22, matchedTerms * 0.06))
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

function toReadableSettingKey(key: string) {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((segment) => segment.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .join(" / ")
}

function localizeSettingFieldLabel(key: string, tSettings: (key: any) => string) {
  const translationKey = SETTING_LABEL_BY_KEY[key]
  if (!translationKey) return toReadableSettingKey(key)
  const localized = tSettings(translationKey)
  return localized === translationKey ? toReadableSettingKey(key) : localized
}

function localizeSettingGroupLabel(key: string, tSettings: (key: any) => string) {
  const prefix = key.split(".")[0] || ""
  const translationKey = SETTING_GROUP_BY_PREFIX[prefix]
  if (!translationKey) return "设置"
  const localized = tSettings(translationKey)
  return localized === translationKey ? "设置" : localized
}

function getSettingTargetTab(key: string) {
  const prefix = key.split(".")[0] || ""
  return SETTING_TAB_BY_PREFIX[prefix] || "general"
}

export default function SearchPage() {
  const { t } = useTranslation("search")
  const { t: tc } = useTranslation("common")
  const { t: ts } = useTranslation("settings")
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get("q")?.trim() ?? ""
  const [query, setQuery] = useState(urlQuery)
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([])
  const [committedQuery, setCommittedQuery] = useState(urlQuery)
  const [hasSearched, setHasSearched] = useState(false)
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS)
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

  const { data: appSettings = [] } = useQuery({
    queryKey: ["allAppSettings"],
    queryFn: api.getAllAppSettings,
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

  const handleSearch = useCallback((searchQuery?: string) => {
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
    setHasSearched(true)

    if (!options.includeSemantic) {
      setSemanticResults([])
      return
    }

    if (!providers) {
      setSemanticResults([])
      return
    }

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
  }, [options.includeSemantic, providers, query, searchMutation, t, tc, toast])

  useEffect(() => {
    if (urlQuery) {
      setQuery(urlQuery)
      handleSearch(urlQuery)
    }
  }, [handleSearch, urlQuery])

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

  const globalDocumentResults = useMemo<DisplaySearchResult[]>(() => {
    const normalizedQuery = committedQuery.trim().toLowerCase()
    if (!normalizedQuery || !options.includeDocuments) return []

    const byDocument = new Map<string, DisplaySearchResult>()

    const collected = libraryDocuments.reduce<DisplaySearchResult[]>((acc, document) => {
      const globalScore = computeGlobalSimilarity(document, normalizedQuery, normalizedHighlightTerms)
      if (globalScore <= 0) return acc

      const semanticHit = semanticBestByDocument.get(document.id)
      const snippetSource = semanticHit?.content || `${document.title} ${document.filename}`

      acc.push({
        key: `global-${document.id}`,
        type: "global",
        title: document.filename,
        similarity: semanticHit ? Math.max(globalScore, semanticHit.score) : globalScore,
        snippet: buildSnippet(snippetSource, highlightTerms),
        documentId: document.id,
      })

      return acc
    }, [])

    for (const item of collected) {
      if (!item.documentId) continue
      byDocument.set(item.documentId, item)
    }

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
          title: documentMap.get(hit.document_id)?.filename ?? hit.document_id,
          similarity: nextSimilarity,
          snippet: buildSnippet(hit.content, highlightTerms),
          documentId: hit.document_id,
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

    return [...byDocument.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.maxGlobalResults)
  }, [committedQuery, documentMap, highlightTerms, libraryDocuments, normalizedHighlightTerms, options.includeDocuments, options.maxGlobalResults, semanticBestByDocument, semanticResults])

  const settingResults = useMemo<DisplaySearchResult[]>(() => {
    const normalizedQuery = committedQuery.trim().toLowerCase()
    if (!normalizedQuery || !options.includeSettings) return []

    const collected = appSettings.reduce<DisplaySearchResult[]>((acc, item) => {
      const fieldLabel = localizeSettingFieldLabel(item.key, ts)
      const groupLabel = localizeSettingGroupLabel(item.key, ts)
      const settingTitle = `${groupLabel} / ${fieldLabel}`
      const similarity = computeSettingSimilarity(
        item.key,
        item.value,
        settingTitle,
        normalizedQuery,
        normalizedHighlightTerms
      )
      if (similarity <= 0) return acc

      acc.push({
        key: `setting-${item.key}`,
        type: "setting",
        title: settingTitle,
        snippet: buildSnippet(`${settingTitle}: ${item.value}`, highlightTerms),
        similarity,
        settingKey: item.key,
      })

      return acc
    }, [])

    return collected.sort((a, b) => b.similarity - a.similarity).slice(0, options.maxGlobalResults)
  }, [appSettings, committedQuery, highlightTerms, normalizedHighlightTerms, options.includeSettings, options.maxGlobalResults, ts])

  const semanticOnlyResults = useMemo<DisplaySearchResult[]>(() => {
    if (!options.includeSemantic) return []

    const excluded = new Set(globalDocumentResults.map((item) => item.documentId).filter(Boolean))
    return semanticResults
      .filter((result) => result.score >= options.minSemanticScore)
      .filter((result) => !excluded.has(result.document_id))
      .map((result) => ({
        key: result.chunk_id,
        type: "semantic" as const,
        title: documentMap.get(result.document_id)?.filename ?? result.document_id,
        similarity: result.score,
        snippet: buildSnippet(result.content, highlightTerms),
        documentId: result.document_id,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.maxSemanticResults)
  }, [documentMap, globalDocumentResults, highlightTerms, options.includeSemantic, options.maxSemanticResults, options.minSemanticScore, semanticResults])

  const globalPool = useMemo(
    () => [...globalDocumentResults, ...settingResults].sort((a, b) => b.similarity - a.similarity),
    [globalDocumentResults, settingResults]
  )

  const combinedResults = useMemo(() => {
    if (options.priority === "semantic-first") {
      return [...semanticOnlyResults, ...globalPool]
    }
    return [...globalPool, ...semanticOnlyResults]
  }, [globalPool, options.priority, semanticOnlyResults])

  const hasAnyResult = combinedResults.length > 0

  const renderResultCard = (result: DisplaySearchResult) => {
    const document = result.documentId ? documentMap.get(result.documentId) : undefined
    const title = result.title
    const isPdf = !!document && title.toLowerCase().endsWith(".pdf") && !document.is_file_missing
    const Icon = getFileIcon(title)

    return (
      <Card key={result.key} className="overflow-hidden border-border/70">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="mt-0.5 flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
                {result.type === "setting" ? <Settings2 className="h-5 w-5 text-muted-foreground" /> : isPdf ? <PdfSearchPreview filePath={document.file_path} /> : <Icon className="h-5 w-5 text-muted-foreground" />}
              </div>

              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-semibold">{title}</p>
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
                {result.type === "global" ? "全局-文档" : result.type === "setting" ? "全局-设置" : "语义"}
              </Badge>
              {result.type === "setting" ? (
                <Button asChild size="sm" variant="outline" className="rounded-lg">
                  <Link
                    to={
                      result.settingKey
                        ? `/settings?tab=${encodeURIComponent(getSettingTargetTab(result.settingKey))}&setting=${encodeURIComponent(result.settingKey)}`
                        : "/settings"
                    }
                  >
                    前往设置
                  </Link>
                </Button>
              ) : result.documentId ? (
                <Button asChild size="sm" className="rounded-lg">
                  <Link to={`/document/${result.documentId}`}>{t("results.view_document")}</Link>
                </Button>
              ) : null}
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

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4" />
            综合搜索设置
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={options.includeDocuments}
                onChange={(event) => setOptions((prev) => ({ ...prev, includeDocuments: event.target.checked }))}
              />
              文档全局匹配
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={options.includeSettings}
                onChange={(event) => setOptions((prev) => ({ ...prev, includeSettings: event.target.checked }))}
              />
              设置项检索
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={options.includeSemantic}
                onChange={(event) => setOptions((prev) => ({ ...prev, includeSemantic: event.target.checked }))}
              />
              语义检索
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs text-muted-foreground">
              优先级
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={options.priority}
                onChange={(event) =>
                  setOptions((prev) => ({
                    ...prev,
                    priority: event.target.value === "semantic-first" ? "semantic-first" : "global-first",
                  }))
                }
              >
                <option value="global-first">全局优先</option>
                <option value="semantic-first">语义优先</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-muted-foreground">
              全局结果上限
              <Input
                type="number"
                min={1}
                max={100}
                value={options.maxGlobalResults}
                onChange={(event) =>
                  setOptions((prev) => ({ ...prev, maxGlobalResults: Math.max(1, Math.min(100, Number(event.target.value) || 1)) }))
                }
              />
            </label>

            <label className="space-y-1 text-xs text-muted-foreground">
              语义结果上限
              <Input
                type="number"
                min={1}
                max={100}
                value={options.maxSemanticResults}
                onChange={(event) =>
                  setOptions((prev) => ({ ...prev, maxSemanticResults: Math.max(1, Math.min(100, Number(event.target.value) || 1)) }))
                }
              />
            </label>

            <label className="space-y-1 text-xs text-muted-foreground">
              语义阈值（0-1）
              <Input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={options.minSemanticScore}
                onChange={(event) =>
                  setOptions((prev) => ({
                    ...prev,
                    minSemanticScore: Math.max(0, Math.min(1, Number(event.target.value) || 0)),
                  }))
                }
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {hasAnyResult && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("results.count", { count: combinedResults.length })}
          </p>
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">综合结果</p>
            {combinedResults.map((result) => renderResultCard(result))}
          </div>
        </div>
      )}

      {hasSearched && !searchMutation.isPending && !hasAnyResult && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t("results.no_results")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
