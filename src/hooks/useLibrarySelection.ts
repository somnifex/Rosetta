import { useMemo, useState } from "react"

export function useLibrarySelection() {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const clearSelection = () => {
    setSelectionMode(false)
    setSelectedIds([])
    setLastSelectedId(null)
  }

  const toggleId = (id: string, orderedIds: string[], shiftKey = false) => {
    setSelectionMode(true)

    setSelectedIds((current) => {
      const currentSet = new Set(current)

      if (shiftKey && lastSelectedId) {
        const startIndex = orderedIds.indexOf(lastSelectedId)
        const endIndex = orderedIds.indexOf(id)
        if (startIndex >= 0 && endIndex >= 0) {
          const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
          for (const currentId of orderedIds.slice(from, to + 1)) {
            currentSet.add(currentId)
          }
          return Array.from(currentSet)
        }
      }

      if (currentSet.has(id)) {
        currentSet.delete(id)
      } else {
        currentSet.add(id)
      }

      return Array.from(currentSet)
    })

    setLastSelectedId(id)
  }

  return {
    selectionMode,
    setSelectionMode,
    selectedIds,
    selectedSet,
    selectedCount: selectedIds.length,
    hasSelection: selectedIds.length > 0,
    toggleId,
    selectAll: (ids: string[]) => {
      setSelectionMode(true)
      setSelectedIds(ids)
      setLastSelectedId(ids.length > 0 ? ids[ids.length - 1] : null)
    },
    clearSelection,
    isSelected: (id: string) => selectedSet.has(id),
  }
}
