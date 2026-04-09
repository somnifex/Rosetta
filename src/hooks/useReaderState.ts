import { useEffect, useMemo, useState } from "react"
import { clamp } from "@/lib/utils"
import { SK_READER_STATE_PREFIX } from "@/lib/storage-keys"

export type ReaderBaseMode = "original" | "translated" | "compare"
export type ReaderMode = ReaderBaseMode | "ask" | "compare-ask"
export type CompareOrder = "original-left" | "translated-left"
export type ReaderTextView = "layout" | "markdown"

export interface ReaderPersistedState {
  baseMode: ReaderBaseMode
  askOpen: boolean
  originalPage: number
  translatedPage: number
  originalScale: number
  translatedScale: number
  textScale: number
  textView: ReaderTextView
  compareRatio: number
  compareOrder: CompareOrder
}

const DEFAULT_STATE: ReaderPersistedState = {
  baseMode: "original",
  askOpen: false,
  originalPage: 1,
  translatedPage: 1,
  originalScale: 1,
  translatedScale: 1,
  textScale: 1,
  textView: "layout",
  compareRatio: 0.5,
  compareOrder: "original-left",
}

function getStorageKey(documentId: string) {
  return `${SK_READER_STATE_PREFIX}${documentId}`
}

function sanitizeMode(mode: string | null | undefined): ReaderMode | null {
  if (!mode) return null
  if (["original", "translated", "compare", "ask", "compare-ask"].includes(mode)) {
    return mode as ReaderMode
  }
  return null
}

function parseMode(mode: ReaderMode | null, fallbackBaseMode: ReaderBaseMode, fallbackAskOpen: boolean) {
  switch (mode) {
    case "translated":
      return { baseMode: "translated" as const, askOpen: false }
    case "compare":
      return { baseMode: "compare" as const, askOpen: false }
    case "ask":
      return { baseMode: "original" as const, askOpen: true }
    case "compare-ask":
      return { baseMode: "compare" as const, askOpen: true }
    case "original":
      return { baseMode: "original" as const, askOpen: false }
    default:
      return { baseMode: fallbackBaseMode, askOpen: fallbackAskOpen }
  }
}

function clampPage(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}

function clampScale(value: number) {
  return clamp(Number.isFinite(value) ? value : 1, 0.5, 3)
}

function clampTextScale(value: number) {
  return clamp(Number.isFinite(value) ? value : 1, 0.8, 1.8)
}

function clampRatio(value: number) {
  return clamp(Number.isFinite(value) ? value : 0.5, 0.25, 0.75)
}

function readInitialState(documentId: string): ReaderPersistedState {
  if (typeof window === "undefined") return DEFAULT_STATE

  try {
    const raw = window.localStorage.getItem(getStorageKey(documentId))
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<ReaderPersistedState>
    return {
      baseMode: parsed.baseMode === "translated" || parsed.baseMode === "compare" ? parsed.baseMode : "original",
      askOpen: parsed.askOpen === true,
      originalPage: clampPage(parsed.originalPage ?? 1),
      translatedPage: clampPage(parsed.translatedPage ?? 1),
      originalScale: clampScale(parsed.originalScale ?? 1),
      translatedScale: clampScale(parsed.translatedScale ?? 1),
      textScale: clampTextScale(parsed.textScale ?? 1),
      textView: parsed.textView === "markdown" ? "markdown" : "layout",
      compareRatio: clampRatio(parsed.compareRatio ?? 0.5),
      compareOrder: parsed.compareOrder === "translated-left" ? "translated-left" : "original-left",
    }
  } catch {
    return DEFAULT_STATE
  }
}

function getInitialState(documentId: string, requestedMode?: string | null): ReaderPersistedState {
  const persisted = readInitialState(documentId)
  const requested = sanitizeMode(requestedMode)
  if (!requested) return persisted

  const next = parseMode(requested, persisted.baseMode, persisted.askOpen)
  return {
    ...persisted,
    baseMode: next.baseMode,
    askOpen: next.askOpen,
  }
}

export function useReaderState(documentId: string, requestedMode?: string | null) {
  const [state, setState] = useState<ReaderPersistedState>(() => getInitialState(documentId, requestedMode))

  useEffect(() => {
    setState(getInitialState(documentId, requestedMode))
  }, [documentId, requestedMode])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(getStorageKey(documentId), JSON.stringify(state))
  }, [documentId, state])

  const requested = sanitizeMode(requestedMode)
  const effectiveMode = useMemo<ReaderMode>(() => {
    if (state.askOpen && state.baseMode === "compare") return "compare-ask"
    if (state.askOpen) return "ask"
    return state.baseMode
  }, [state.askOpen, state.baseMode])

  useEffect(() => {
    if (!requested) return
    setState((current) => {
      const next = parseMode(requested, current.baseMode, current.askOpen)
      if (current.baseMode === next.baseMode && current.askOpen === next.askOpen) {
        return current
      }
      return {
        ...current,
        baseMode: next.baseMode,
        askOpen: next.askOpen,
      }
    })
  }, [requested])

  return {
    state,
    effectiveMode,
    setBaseMode: (baseMode: ReaderBaseMode) => setState((current) => ({ ...current, baseMode })),
    setAskOpen: (askOpen: boolean) => setState((current) => ({ ...current, askOpen })),
    setOriginalPage: (originalPage: number) => setState((current) => ({ ...current, originalPage: clampPage(originalPage) })),
    setTranslatedPage: (translatedPage: number) => setState((current) => ({ ...current, translatedPage: clampPage(translatedPage) })),
    setOriginalScale: (originalScale: number) => setState((current) => ({ ...current, originalScale: clampScale(originalScale) })),
    setTranslatedScale: (translatedScale: number) => setState((current) => ({ ...current, translatedScale: clampScale(translatedScale) })),
    setTextScale: (textScale: number) => setState((current) => ({ ...current, textScale: clampTextScale(textScale) })),
    setTextView: (textView: ReaderTextView) => setState((current) => ({ ...current, textView })),
    setCompareRatio: (compareRatio: number) => setState((current) => ({ ...current, compareRatio: clampRatio(compareRatio) })),
    setCompareOrder: (compareOrder: CompareOrder) => setState((current) => ({ ...current, compareOrder })),
    reset: () => setState(DEFAULT_STATE),
  }
}
