import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const GeneralTab = lazy(() => import("./GeneralTab"))
const TranslationTab = lazy(() => import("./TranslationTab"))
const ExtractionTab = lazy(() => import("./ExtractionTab"))
const ProvidersTab = lazy(() => import("./ProvidersTab"))
const MineruTab = lazy(() => import("./MineruTab"))
const WebDAVTab = lazy(() => import("./WebDAVTab"))
const RagTab = lazy(() => import("./RagTab"))
const LogsTab = lazy(() => import("./LogsTab"))

export default function Settings() {
  const { t } = useTranslation("settings")
  const [searchParams, setSearchParams] = useSearchParams()

  const tabFromQuery = searchParams.get("tab") || "general"
  const settingFromQuery = searchParams.get("setting") || ""
  const validTabs = useMemo(
    () => new Set(["general", "translation", "extraction", "providers", "mineru", "webdav", "rag", "logs"]),
    []
  )

  const [activeTab, setActiveTab] = useState(validTabs.has(tabFromQuery) ? tabFromQuery : "general")

  useEffect(() => {
    const next = validTabs.has(tabFromQuery) ? tabFromQuery : "general"
    setActiveTab(next)
  }, [tabFromQuery, validTabs])

  useEffect(() => {
    if (!settingFromQuery) return

    const escaped = settingFromQuery.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    const timer = window.setTimeout(() => {
      const element = document.querySelector(`[data-setting-key="${escaped}"]`) as HTMLElement | null
      if (!element) return

      element.scrollIntoView({ behavior: "smooth", block: "center" })
      element.classList.add("ring-2", "ring-primary/50")
      window.setTimeout(() => {
        element.classList.remove("ring-2", "ring-primary/50")
      }, 1800)
    }, 120)

    return () => window.clearTimeout(timer)
  }, [activeTab, settingFromQuery])

  const handleTabChange = (nextTab: string) => {
    setActiveTab(nextTab)
    const next = new URLSearchParams(searchParams)
    next.set("tab", nextTab)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
          <TabsTrigger value="translation">{t("tabs.translation")}</TabsTrigger>
          <TabsTrigger value="extraction">{t("tabs.extraction")}</TabsTrigger>
          <TabsTrigger value="providers">{t("tabs.providers")}</TabsTrigger>
          <TabsTrigger value="mineru">{t("tabs.mineru")}</TabsTrigger>
          <TabsTrigger value="webdav">{t("tabs.webdav")}</TabsTrigger>
          <TabsTrigger value="rag">{t("tabs.rag")}</TabsTrigger>
          <TabsTrigger value="logs">{t("tabs.logs")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Suspense fallback={null}><GeneralTab /></Suspense>
        </TabsContent>
        <TabsContent value="translation">
          <Suspense fallback={null}><TranslationTab /></Suspense>
        </TabsContent>
        <TabsContent value="extraction">
          <Suspense fallback={null}><ExtractionTab /></Suspense>
        </TabsContent>
        <TabsContent value="providers">
          <Suspense fallback={null}><ProvidersTab /></Suspense>
        </TabsContent>
        <TabsContent value="mineru">
          <Suspense fallback={null}><MineruTab /></Suspense>
        </TabsContent>
        <TabsContent value="webdav">
          <Suspense fallback={null}><WebDAVTab /></Suspense>
        </TabsContent>
        <TabsContent value="rag">
          <Suspense fallback={null}><RagTab /></Suspense>
        </TabsContent>
        <TabsContent value="logs">
          <Suspense fallback={null}><LogsTab /></Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
