import { useEffect, useState } from "react"

const SIDEBAR_COLLAPSED_KEY = "rosetta:sidebar-collapsed"

function readInitialValue() {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"
}

export function useSidebarPreference() {
  const [collapsed, setCollapsed] = useState(readInitialValue)

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
  }, [collapsed])

  return {
    collapsed,
    setCollapsed,
    toggleCollapsed: () => setCollapsed((current) => !current),
  }
}
