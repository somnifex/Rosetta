import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const GeneralTab = lazy(() => import("./GeneralTab"))
const TranslationTab = lazy(() => import("./TranslationTab"))
const ProvidersTab = lazy(() => import("./ProvidersTab"))
const MineruTab = lazy(() => import("./MineruTab"))
const WebDAVTab = lazy(() => import("./WebDAVTab"))
const RagTab = lazy(() => import("./RagTab"))

export default function Settings() {
  const { t } = useTranslation("settings")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
          <TabsTrigger value="translation">{t("tabs.translation")}</TabsTrigger>
          <TabsTrigger value="providers">{t("tabs.providers")}</TabsTrigger>
          <TabsTrigger value="mineru">{t("tabs.mineru")}</TabsTrigger>
          <TabsTrigger value="webdav">{t("tabs.webdav")}</TabsTrigger>
          <TabsTrigger value="rag">{t("tabs.rag")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Suspense fallback={null}><GeneralTab /></Suspense>
        </TabsContent>
        <TabsContent value="translation">
          <Suspense fallback={null}><TranslationTab /></Suspense>
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
      </Tabs>
    </div>
  )
}
