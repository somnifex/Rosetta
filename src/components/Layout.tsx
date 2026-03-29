import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Home, Library, ListTodo, Settings, Search, MessageSquare } from "lucide-react"
import { Input } from "@/components/ui/input"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { ThemeToggle } from "@/components/ThemeToggle"

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { t: ts } = useTranslation("search")
  const [searchQuery, setSearchQuery] = useState("")

  const navItems = [
    { path: "/", label: t("nav.dashboard"), icon: Home },
    { path: "/chat", label: t("nav.chat"), icon: MessageSquare },
    { path: "/library", label: t("nav.library"), icon: Library },
    { path: "/tasks", label: t("nav.tasks"), icon: ListTodo },
    { path: "/settings", label: t("nav.settings"), icon: Settings },
  ]

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r rtl:border-r-0 rtl:border-l bg-card flex flex-col shrink-0">
        <div className="flex h-14 items-center border-b px-6">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/Logo.png"
              alt={`${t("app_title")} logo`}
              className="h-8 w-8 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-border"
            />
            <h1 className="truncate text-xl font-bold">{t("app_title")}</h1>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main area with header */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header bar */}
        <header className="h-14 border-b bg-card flex items-center px-6 shrink-0">
          {/* Left spacer */}
          <div className="flex-1" />

          {/* Center: Global search */}
          <form onSubmit={handleSearchSubmit} className="w-full max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={ts("input.placeholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9 bg-muted/50"
              />
            </div>
          </form>

          {/* Right: controls */}
          <div className="flex-1 flex items-center justify-end gap-1">
            <ThemeToggle />
            <LanguageSwitcher compact />
          </div>
        </header>

        {/* Page content */}
        <main className={cn(
          "flex-1",
          (location.pathname === "/chat" || location.pathname === "/library" || location.pathname.startsWith("/document/"))
            ? "overflow-hidden"
            : "overflow-auto"
        )}>
          {(location.pathname === "/chat" || location.pathname === "/library" || location.pathname.startsWith("/document/")) ? (
            children
          ) : (
            <div className="container mx-auto p-6">{children}</div>
          )}
        </main>
      </div>
    </div>
  )
}
