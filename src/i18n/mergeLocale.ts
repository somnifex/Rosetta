type LocaleOverrides<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? LocaleOverrides<T[K]>
    : T[K]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function mergeLocale<T>(base: T, overrides?: LocaleOverrides<T>): T {
  if (overrides === undefined) {
    return base
  }

  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return overrides as T
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }

  for (const [key, overrideValue] of Object.entries(overrides)) {
    if (overrideValue === undefined) {
      continue
    }

    const baseValue = result[key]
    result[key] = isPlainObject(baseValue) && isPlainObject(overrideValue)
      ? mergeLocale(baseValue, overrideValue)
      : overrideValue
  }

  return result as T
}
