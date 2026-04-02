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
import {
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
  THEME_CHANGE_EVENT,
  type AppTheme,
} from "@/lib/theme"

export function ThemeToggle() {
  const { t } = useTranslation("settings")
  const [theme, setTheme] = useState<AppTheme>(getStoredTheme)

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      if (event instanceof CustomEvent) {
        setTheme(event.detail ?? getStoredTheme())
        return
      }
      setTheme(getStoredTheme())
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener)
    }
  }, [])

  const handleChange = (value: string) => {
    const next = value as AppTheme
    setTheme(next)
    setStoredTheme(next)
    api.setAppSetting("general.theme", next).catch(() => {})
  }

  const isDark = resolveTheme(theme) === "dark"

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
