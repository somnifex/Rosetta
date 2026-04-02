import { api } from "./api"

export type AppTheme = "light" | "dark" | "system"

export const THEME_STORAGE_KEY = "pdf-translate:theme"
export const THEME_CHANGE_EVENT = "rosetta:theme-change"

export function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function normalizeTheme(value: string | null | undefined): AppTheme {
  if (value === "light" || value === "dark" || value === "system") {
    return value
  }
  return "system"
}

export function getStoredTheme(): AppTheme {
  return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY))
}

export function resolveTheme(theme: AppTheme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme
}

export function applyAppTheme(theme: AppTheme) {
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark")
  void api.syncWindowTheme(theme).catch(() => {})
}

export function setStoredTheme(theme: AppTheme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  window.dispatchEvent(
    new CustomEvent<AppTheme>(THEME_CHANGE_EVENT, {
      detail: theme,
    })
  )
}
