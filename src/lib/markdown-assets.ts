import { convertFileSrc } from "@tauri-apps/api/core"

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/
const UNC_PATH_RE = /^\\\\/
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z\d+.-]*:/

interface ParsedBasePath {
  prefix: string
  segments: string[]
  separator: "/" | "\\"
}

function splitPathAndSuffix(value: string) {
  const hashIndex = value.indexOf("#")
  const queryIndex = value.indexOf("?")
  const cutIndex =
    hashIndex === -1
      ? queryIndex
      : queryIndex === -1
        ? hashIndex
        : Math.min(hashIndex, queryIndex)

  if (cutIndex === -1) {
    return { pathPart: value, suffix: "" }
  }

  return {
    pathPart: value.slice(0, cutIndex),
    suffix: value.slice(cutIndex),
  }
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isAbsoluteFileSystemPath(value: string) {
  return WINDOWS_DRIVE_RE.test(value) || UNC_PATH_RE.test(value) || value.startsWith("/")
}

function normalizeAbsolutePath(value: string) {
  if (WINDOWS_DRIVE_RE.test(value) || UNC_PATH_RE.test(value)) {
    return value.replace(/\//g, "\\")
  }
  return value.replace(/\\/g, "/")
}

function parseBasePath(baseDir: string): ParsedBasePath | null {
  const normalized = baseDir.trim().replace(/\\/g, "/")
  if (!normalized) return null

  if (WINDOWS_DRIVE_RE.test(normalized)) {
    return {
      prefix: normalized.slice(0, 2),
      segments: normalized.slice(3).split("/").filter(Boolean),
      separator: "\\",
    }
  }

  if (normalized.startsWith("//")) {
    const parts = normalized.slice(2).split("/").filter(Boolean)
    if (parts.length < 2) return null
    return {
      prefix: `\\\\${parts[0]}\\${parts[1]}`,
      segments: parts.slice(2),
      separator: "\\",
    }
  }

  if (normalized.startsWith("/")) {
    return {
      prefix: "/",
      segments: normalized.slice(1).split("/").filter(Boolean),
      separator: "/",
    }
  }

  return {
    prefix: "",
    segments: normalized.split("/").filter(Boolean),
    separator: "/",
  }
}

function formatResolvedPath(base: ParsedBasePath, segments: string[]) {
  if (base.separator === "\\") {
    if (base.prefix.startsWith("\\\\")) {
      return segments.length ? `${base.prefix}\\${segments.join("\\")}` : base.prefix
    }
    return segments.length ? `${base.prefix}\\${segments.join("\\")}` : `${base.prefix}\\`
  }

  if (base.prefix === "/") {
    return segments.length ? `/${segments.join("/")}` : "/"
  }

  return segments.join("/")
}

export function resolveMarkdownAssetPath(
  rawPath: string | null | undefined,
  assetBaseDir?: string | null
) {
  const input = typeof rawPath === "string" ? rawPath.trim() : ""
  if (!input || input.startsWith("#") || URL_SCHEME_RE.test(input)) {
    return null
  }

  const { pathPart } = splitPathAndSuffix(input)
  const decodedPath = safeDecode(pathPart.trim())
  if (!decodedPath) return null

  if (isAbsoluteFileSystemPath(decodedPath)) {
    return normalizeAbsolutePath(decodedPath)
  }

  if (!assetBaseDir?.trim()) {
    return null
  }

  const base = parseBasePath(assetBaseDir)
  if (!base) return null

  const segments = [...base.segments]
  for (const segment of decodedPath.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length > 0) segments.pop()
      continue
    }
    segments.push(segment)
  }

  return formatResolvedPath(base, segments)
}

export function resolveMarkdownAssetUrl(
  rawPath: string | null | undefined,
  assetBaseDir?: string | null
) {
  const input = typeof rawPath === "string" ? rawPath.trim() : ""
  if (!input) return null
  if (input.startsWith("#") || URL_SCHEME_RE.test(input)) return input

  const { suffix } = splitPathAndSuffix(input)
  const resolvedPath = resolveMarkdownAssetPath(input, assetBaseDir)
  if (!resolvedPath) return null
  return `${convertFileSrc(resolvedPath)}${suffix}`
}
