import { useEffect, useState } from "react"
import { SK_SIDEBAR_COLLAPSED } from "@/lib/storage-keys"

function readInitialValue() {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(SK_SIDEBAR_COLLAPSED) === "true"
}

export function useSidebarPreference() {
  const [collapsed, setCollapsed] = useState(readInitialValue)

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(SK_SIDEBAR_COLLAPSED, String(collapsed))
  }, [collapsed])

  return {
    collapsed,
    setCollapsed,
    toggleCollapsed: () => setCollapsed((current) => !current),
  }
}
