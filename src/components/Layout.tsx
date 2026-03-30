import { useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Home, Library, ListTodo, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Search, Settings } from "lucide-react"
import { Input } from "@/components/ui/input"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useSidebarPreference } from "@/hooks/useSidebarPreference"

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { t: ts } = useTranslation("search")
  const { collapsed, toggleCollapsed } = useSidebarPreference()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const navItems = [
    { path: "/", label: t("nav.dashboard"), icon: Home },
    { path: "/chat", label: t("nav.chat"), icon: MessageSquare },
    { path: "/library", label: t("nav.library"), icon: Library },
    { path: "/tasks", label: t("nav.tasks"), icon: ListTodo },
    { path: "/settings", label: t("nav.settings"), icon: Settings },
  ]

  const isDocumentReaderPage = location.pathname.startsWith("/document/")
  const immersivePage =
    location.pathname === "/chat" ||
    location.pathname === "/library" ||
    isDocumentReaderPage

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!searchQuery.trim()) return
    navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
  }

  const navContent = (compact = false) => (
    <div className="flex h-full flex-col bg-background">
      <div className={cn("flex h-14 items-center border-b", compact ? "px-5" : collapsed ? "justify-center px-3" : "px-5")}>
        <div className={cn("flex items-center gap-3", collapsed && !compact && "justify-center")}>
          <img
            src="/Logo.png"
            alt={`${t("app_title")} logo`}
            className="h-8 w-8 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-border"
          />
          {(!collapsed || compact) && <h1 className="truncate text-lg font-semibold">{t("app_title")}</h1>}
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileSidebarOpen(false)}
              className={cn(
                "flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors mb-0.5",
                collapsed && !compact ? "justify-center" : "gap-3",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {(!collapsed || compact) && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>
    </div>
  )

  if (isDocumentReaderPage) {
    return <div className="h-full min-h-0 overflow-hidden bg-background">{children}</div>
  }

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className={cn("hidden border-r transition-all duration-200 md:block", collapsed ? "w-[78px]" : "w-64")}>
        {navContent()}
      </aside>

      <Dialog open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <DialogContent className="left-0 top-0 h-full max-w-[320px] translate-x-0 translate-y-0 rounded-none border-r p-0 md:hidden">
          {navContent(true)}
        </DialogContent>
      </Dialog>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-background px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={toggleCollapsed}>
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </Button>

            <form onSubmit={handleSearchSubmit} className="min-w-0 flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={ts("input.placeholder")}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="h-9 rounded-full bg-muted shadow-none border-none pl-10"
                />
              </div>
            </form>

            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LanguageSwitcher compact />
            </div>
          </div>
        </header>

        <main className={cn("flex-1 min-h-0", immersivePage ? "overflow-hidden" : "overflow-auto")}>
          {immersivePage ? children : <div className="container mx-auto p-6">{children}</div>}
        </main>
      </div>
    </div>
  )
}
