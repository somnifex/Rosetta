import { useEffect, useState } from "react"

export type LibraryStatusKey = "all" | "completed" | "pending" | "processing" | "failed" | "deleted"
export type LibraryViewMode = "grid" | "list"
export type LibrarySortField = "updated" | "created" | "name" | "size"

export interface LibraryViewState {
  viewMode: LibraryViewMode
  searchQuery: string
  selectedCategoryKey: string
  selectedFolderId: string | null
  selectedTagIds: string[]
  selectedStatus: LibraryStatusKey
  sortField: LibrarySortField
  activeSection: "library" | "trash"
}

const STORAGE_KEY = "rosetta:library-view-state"

const DEFAULT_STATE: LibraryViewState = {
  viewMode: "grid",
  searchQuery: "",
  selectedCategoryKey: "all",
  selectedFolderId: null,
  selectedTagIds: [],
  selectedStatus: "all",
  sortField: "updated",
  activeSection: "library",
}

function readInitialState(): LibraryViewState {
  if (typeof window === "undefined") return DEFAULT_STATE

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<LibraryViewState>
    return {
      ...DEFAULT_STATE,
      ...parsed,
      selectedTagIds: Array.isArray(parsed.selectedTagIds) ? parsed.selectedTagIds : [],
      selectedFolderId: typeof parsed.selectedFolderId === "string" ? parsed.selectedFolderId : null,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function useLibraryViewState() {
  const [state, setState] = useState<LibraryViewState>(readInitialState)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  return {
    state,
    setState,
  }
}
