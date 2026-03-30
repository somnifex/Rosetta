import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { getActiveProviderForType } from "@/lib/providers"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Search } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Link } from "react-router-dom"

interface SearchResult {
  chunk_id: string
  document_id: string
  content: string
  score: number
}

export default function SearchPage() {
  const { t } = useTranslation("search")
  const { t: tc } = useTranslation("common")
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>([])
  const { toast } = useToast()

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
  })

  const searchMutation = useMutation({
    mutationFn: (data: { query: string; providerId: string }) =>
      api.searchDocuments(data.query, data.providerId, 10),
    onSuccess: (data) => {
      setResults(data)
    },
    onError: (error: any) => {
      toast({
        title: t("toast.search_error.title"),
        description: error.message,
        variant: "destructive",
      })
    },
  })

  const handleSearch = (searchQuery?: string) => {
    const q = searchQuery ?? query
    if (!q.trim()) {
      toast({
        title: t("toast.empty_query.title"),
        description: t("toast.empty_query.description"),
        variant: "destructive",
      })
      return
    }

    const activeProvider = getActiveProviderForType(providers, "embed")
    if (!activeProvider) {
      toast({
        title: tc("no_active_provider.title"),
        description: tc("no_active_provider.description"),
        variant: "destructive",
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
    if (q && q.trim() && providers) {
      setQuery(q)
      handleSearch(q)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("q"), providers])

  const handleSubmit = () => {
    if (query.trim()) {
      setSearchParams({ q: query.trim() })
    }
    handleSearch()
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

      {results.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("results.count", { count: results.length })}
          </p>
          {results.map((result) => (
            <Card key={result.chunk_id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">
                    <Link
                      to={`/document/${result.document_id}`}
                      className="hover:underline text-primary"
                    >
                      {t("results.view_document")}
                    </Link>
                  </CardTitle>
                  <Badge variant="secondary">
                    {(result.score * 100).toFixed(1)}%
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap line-clamp-3">
                  {result.content}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {searchMutation.isSuccess && results.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t("results.no_results")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
