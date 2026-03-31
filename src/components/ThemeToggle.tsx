import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Sun, Moon, Monitor } from "lucide-react"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { api } from "@/lib/api"

type Theme = "light" | "dark" | "system"

const THEME_STORAGE_KEY = "pdf-translate:theme"

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme
  document.documentElement.classList.toggle("dark", resolved === "dark")
}

export function ThemeToggle() {
  const { t } = useTranslation("settings")
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem(THEME_STORAGE_KEY) as Theme) || "system"
  })

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (theme !== "system") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => applyTheme("system")
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [theme])

  const handleChange = (value: string) => {
    const next = value as Theme
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    api.setAppSetting("general.theme", next).catch(() => {})
  }

  const isDark =
    theme === "dark" || (theme === "system" && getSystemTheme() === "dark")

  const TriggerIcon = theme === "system" ? Monitor : isDark ? Moon : Sun

  return (
    <Select value={theme} onValueChange={handleChange}>
      <SelectTrigger className="h-9 w-9 p-0 justify-center border-none bg-transparent hover:bg-accent [&>svg:last-child]:hidden">
        <TriggerIcon className="h-4 w-4" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="light">
          <span className="flex items-center gap-2">
            <Sun className="h-4 w-4" />
            {t("general.theme_options.light")}
          </span>
        </SelectItem>
        <SelectItem value="dark">
          <span className="flex items-center gap-2">
            <Moon className="h-4 w-4" />
            {t("general.theme_options.dark")}
          </span>
        </SelectItem>
        <SelectItem value="system">
          <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            {t("general.theme_options.system")}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
