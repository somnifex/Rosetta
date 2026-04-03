import { Suspense, lazy, useEffect } from "react"
import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { SUPPORTED_LOCALES } from "@/i18n"
import { AppUpdaterProvider } from "@/components/AppUpdaterProvider"
import { Toaster } from "@/components/ui/toaster"
import Layout from "@/components/Layout"
import { applyAppTheme, getStoredTheme, THEME_CHANGE_EVENT } from "@/lib/theme"

const Dashboard = lazy(() => import("@/pages/Dashboard"))
const Library = lazy(() => import("@/pages/Library"))
const DocumentDetail = lazy(() => import("@/pages/DocumentDetail"))
const Search = lazy(() => import("@/pages/Search"))
const Tasks = lazy(() => import("@/pages/Tasks"))
const Chat = lazy(() => import("@/pages/Chat"))
const Settings = lazy(() => import("@/pages/settings"))

const queryClient = new QueryClient()

function DirectionSetter() {
  const { i18n, t } = useTranslation()

  useEffect(() => {
    const locale = SUPPORTED_LOCALES.find((l) => l.code === i18n.language)
    document.documentElement.dir = locale?.dir ?? "ltr"
    document.documentElement.lang = i18n.language
    document.title = t("app_title")
  }, [i18n.language, t])

  return null
}

function BrowserBehaviorGuard() {
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return

    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = "manual"

    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  return null
}

function ThemeController() {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const applyStoredTheme = () => applyAppTheme(getStoredTheme())
    const handleThemeChange = (event: Event) => {
      const nextTheme =
        event instanceof CustomEvent ? event.detail ?? getStoredTheme() : getStoredTheme()
      applyAppTheme(nextTheme)
    }
    const handleSystemThemeChange = () => {
      if (getStoredTheme() === "system") {
        applyStoredTheme()
      }
    }

    applyStoredTheme()
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener)
    mediaQuery.addEventListener("change", handleSystemThemeChange)

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener)
      mediaQuery.removeEventListener("change", handleSystemThemeChange)
    }
  }, [])

  return null
}

function App() {
  return (
    <Suspense fallback={null}>
      <QueryClientProvider client={queryClient}>
        <DirectionSetter />
        <BrowserBehaviorGuard />
        <ThemeController />
        <AppUpdaterProvider>
          <Router>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/library" element={<Library />} />
                <Route path="/document/:id" element={<DocumentDetail />} />
                <Route path="/search" element={<Search />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Layout>
          </Router>
        </AppUpdaterProvider>
        <Toaster />
      </QueryClientProvider>
    </Suspense>
  )
}

export default App
