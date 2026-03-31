import type { LlmSamplingConfig } from "../../packages/types"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { readFile } from "@tauri-apps/plugin-fs"
import { api } from "./api"
import {
  getActiveProviderForType,
  getPrimaryModelForType,
  toOpenAiChannelConfig,
} from "./providers"

export interface ChatAttachment {
  documentId: string
  title: string
  filename: string
}

export interface ChatSource {
  documentId: string
  documentTitle: string
  chunkId: string
  chunkIndex: number
  score: number
  content: string
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  attachments?: ChatAttachment[]
  sources?: ChatSource[]
}

export type ChatRequestMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export interface ChatRequestMessage {
  role: "user" | "assistant" | "system"
  content: string | ChatRequestMessageContentPart[]
}

export type ChatConversationScope = "general" | "document"
export type ChatTitleSource = "fallback" | "ai" | "manual"

export interface ChatConversation {
  id: string
  title: string
  titleSource?: ChatTitleSource
  scope: ChatConversationScope
  contextAttachments: ChatAttachment[]
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  systemPrompt?: string
  sampling?: LlmSamplingConfig
  retrievalTopK?: number
  alwaysIncludeFullDocument?: boolean
}

export type ChatStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; sources: ChatSource[] }

const CONVERSATIONS_KEY = "rosetta:chat-conversations:v2"
const LEGACY_CONVERSATIONS_KEY = "pdf-translate:chat-conversations"
export const LEGACY_READER_CHAT_PREFIX = "rosetta:reader-chat:"
export const LEGACY_DOCUMENT_CHAT_PREFIX = "pdf-translate:document-chat:"

const EVENT_CHAT_CHUNK = "rag-chat-chunk"
const EVENT_CHAT_DONE = "rag-chat-done"
const EVENT_CHAT_ERROR = "rag-chat-error"

const DEFAULT_DOCUMENT_APPEND_PROMPT =
  "用户问题：{{user_input}}\n\n以下是文档全文，请优先基于全文回答并在结论后指出关键依据：\n\n{{document_content}}"

const DEFAULT_LONG_TEXT_RAG_PROMPT =
  "用户输入很长，请先给出结构化摘要，再按要点回答，必要时明确指出不确定性。\n\n原始输入：\n{{user_input}}"

const DEFAULT_CHAT_MODEL_BEHAVIOR_DESCRIPTION =
  "普通对话默认不走本地RAG；文档线程可按设置注入全文；长文本自动提示并切换本地RAG；若模型支持视觉会自动附带图片。"

export interface ChatBehaviorSettings {
  modelBehaviorDescription: string
  documentAppendPrompt: string
  longTextRagPrompt: string
  longTextThreshold: number
  defaultAlwaysIncludeFullDocument: boolean
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function clampNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

function normalizeSamplingConfig(value: unknown): LlmSamplingConfig | undefined {
  if (!value || typeof value !== "object") return undefined

  const sampling = value as Record<string, unknown>
  const normalized: LlmSamplingConfig = {
    temperature: clampNumber(sampling.temperature, 0, 2),
    top_p: clampNumber(sampling.top_p, 0, 1),
    top_k: clampNumber(sampling.top_k, 1, 200),
    max_tokens: clampNumber(sampling.max_tokens, 1, 32768),
  }

  if (
    normalized.temperature == null &&
    normalized.top_p == null &&
    normalized.top_k == null &&
    normalized.max_tokens == null
  ) {
    return undefined
  }

  return normalized
}

function normalizeAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const documentId = cleanString(raw.documentId ?? raw.document_id)
  if (!documentId) return null

  return {
    documentId,
    title: cleanString(raw.title) || cleanString(raw.documentTitle) || documentId,
    filename: cleanString(raw.filename),
  }
}

function normalizeAttachments(value: unknown) {
  if (!Array.isArray(value)) return [] as ChatAttachment[]
  return value.map(normalizeAttachment).filter(Boolean) as ChatAttachment[]
}

function dedupeAttachments(attachments: ChatAttachment[]) {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    if (seen.has(attachment.documentId)) return false
    seen.add(attachment.documentId)
    return true
  })
}

function normalizeSource(value: unknown): ChatSource | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const chunkId = cleanString(raw.chunkId ?? raw.chunk_id)
  const documentId = cleanString(raw.documentId ?? raw.document_id)
  if (!chunkId || !documentId) return null

  return {
    documentId,
    documentTitle:
      cleanString(raw.documentTitle ?? raw.document_title) || documentId,
    chunkId,
    chunkIndex:
      typeof raw.chunkIndex === "number"
        ? raw.chunkIndex
        : typeof raw.chunk_index === "number"
          ? raw.chunk_index
          : 0,
    score: typeof raw.score === "number" ? raw.score : 0,
    content: cleanString(raw.content),
  }
}

function normalizeSources(value: unknown) {
  if (!Array.isArray(value)) return [] as ChatSource[]
  return value.map(normalizeSource).filter(Boolean) as ChatSource[]
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const role = cleanString(raw.role)
  if (role !== "user" && role !== "assistant" && role !== "system") return null

  return {
    id: cleanString(raw.id) || genId(),
    role,
    content: typeof raw.content === "string" ? raw.content : "",
    timestamp:
      typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)
        ? raw.timestamp
        : Date.now(),
    attachments: normalizeAttachments(raw.attachments),
    sources: normalizeSources(raw.sources),
  }
}

function normalizeMessages(value: unknown) {
  if (!Array.isArray(value)) return [] as ChatMessage[]
  return value.map(normalizeMessage).filter(Boolean) as ChatMessage[]
}

function normalizeConversation(value: unknown): ChatConversation | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>

  const messages = normalizeMessages(raw.messages)
  const contextAttachments = normalizeAttachments(
    raw.contextAttachments ?? raw.context_attachments
  )
  const legacyDocumentId = cleanString(raw.documentId ?? raw.document_id)
  const legacyDocumentTitle = cleanString(raw.documentTitle ?? raw.document_title)
  const legacyTitle = cleanString(raw.title)
  const firstUserMessage = messages.find((message) => message.role === "user")
  const fallbackTitle =
    legacyTitle ||
    deriveConversationTitleCandidate(firstUserMessage?.content ?? "", "New Chat")

  const scope =
    raw.scope === "document" || legacyDocumentId ? "document" : "general"

  const migratedAttachments =
    legacyDocumentId && contextAttachments.length === 0
      ? [
          {
            documentId: legacyDocumentId,
            title: legacyDocumentTitle || fallbackTitle,
            filename: "",
          },
        ]
      : contextAttachments

  return {
    id: cleanString(raw.id) || genId(),
    title: fallbackTitle,
    titleSource:
      raw.titleSource === "manual" || raw.titleSource === "ai"
        ? raw.titleSource
        : "fallback",
    scope,
    contextAttachments: migratedAttachments,
    messages,
    createdAt:
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : Date.now(),
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
    systemPrompt: cleanString(raw.systemPrompt ?? raw.system_prompt) || undefined,
    sampling: normalizeSamplingConfig(raw.sampling),
    retrievalTopK: clampNumber(raw.retrievalTopK ?? raw.retrieval_top_k, 1, 12),
    alwaysIncludeFullDocument:
      typeof (raw.alwaysIncludeFullDocument ?? raw.always_include_full_document) === "boolean"
        ? Boolean(raw.alwaysIncludeFullDocument ?? raw.always_include_full_document)
        : undefined,
  }
}

function sortConversations(conversations: ChatConversation[]) {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}

function serializeConversations(conversations: ChatConversation[]) {
  return JSON.stringify(sortConversations(conversations))
}

function readConversationStorage() {
  const next = window.localStorage.getItem(CONVERSATIONS_KEY)
  if (next) {
    return next
  }
  return window.localStorage.getItem(LEGACY_CONVERSATIONS_KEY)
}

function getLegacyDocumentStorageKeys() {
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key) continue
    if (
      key.startsWith(LEGACY_READER_CHAT_PREFIX) ||
      key.startsWith(LEGACY_DOCUMENT_CHAT_PREFIX)
    ) {
      keys.push(key)
    }
  }
  return keys
}

function readLegacyDocumentMessages(key: string) {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return [] as ChatMessage[]
    return normalizeMessages(JSON.parse(raw))
  } catch {
    return [] as ChatMessage[]
  }
}

function extractDocumentIdFromLegacyKey(key: string) {
  if (key.startsWith(LEGACY_READER_CHAT_PREFIX)) {
    return key.slice(LEGACY_READER_CHAT_PREFIX.length)
  }
  if (key.startsWith(LEGACY_DOCUMENT_CHAT_PREFIX)) {
    return key.slice(LEGACY_DOCUMENT_CHAT_PREFIX.length)
  }
  return ""
}

function removeLegacyDocumentConversationStorage(documentId: string) {
  window.localStorage.removeItem(`${LEGACY_READER_CHAT_PREFIX}${documentId}`)
  window.localStorage.removeItem(`${LEGACY_DOCUMENT_CHAT_PREFIX}${documentId}`)
}

function migrateLegacyDocumentConversations(conversations: ChatConversation[]) {
  const next = [...conversations]
  const existingDocumentIds = new Set(
    next.flatMap((conversation) =>
      conversation.scope === "document"
        ? conversation.contextAttachments.map((attachment) => attachment.documentId)
        : []
    )
  )

  for (const key of getLegacyDocumentStorageKeys()) {
    const documentId = extractDocumentIdFromLegacyKey(key)
    if (!documentId) {
      continue
    }

    if (existingDocumentIds.has(documentId)) {
      removeLegacyDocumentConversationStorage(documentId)
      continue
    }

    const messages = readLegacyDocumentMessages(key)
    if (messages.length === 0) {
      removeLegacyDocumentConversationStorage(documentId)
      continue
    }

    const firstUserMessage = messages.find((message) => message.role === "user")
    const createdAt = messages[0]?.timestamp ?? Date.now()
    const updatedAt = messages[messages.length - 1]?.timestamp ?? createdAt
    next.push(
      createConversation(
        deriveConversationTitleCandidate(firstUserMessage?.content ?? "", documentId),
        {
          scope: "document",
          contextAttachments: [
            {
              documentId,
              title: documentId,
              filename: "",
            },
          ],
          messages,
          createdAt,
          updatedAt,
        }
      )
    )
    existingDocumentIds.add(documentId)
    removeLegacyDocumentConversationStorage(documentId)
  }

  return next
}

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function deriveConversationTitleCandidate(content: string, fallback: string) {
  const normalized = content.replace(/\s+/g, " ").trim()
  if (!normalized) return fallback
  return normalized.slice(0, 48)
}

export function sanitizeGeneratedTitle(title: string, fallback: string) {
  const normalized = title
    .replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return normalized ? normalized.slice(0, 48) : fallback
}

export function getConversationPreview(conversation: ChatConversation) {
  const lastMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role !== "system" && message.content.trim())

  if (!lastMessage) {
    if (conversation.scope === "document" && conversation.contextAttachments[0]) {
      return conversation.contextAttachments[0].title
    }
    return ""
  }

  return lastMessage.content.replace(/\s+/g, " ").trim()
}

export function getConversationSearchText(conversation: ChatConversation) {
  return [
    conversation.title,
    conversation.systemPrompt ?? "",
    ...conversation.contextAttachments.map((attachment) => attachment.title),
    ...conversation.messages.map((message) => message.content),
  ]
    .join(" \n ")
    .toLowerCase()
}

export function conversationMatchesQuery(conversation: ChatConversation, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return getConversationSearchText(conversation).includes(normalized)
}

export function loadConversations(): ChatConversation[] {
  try {
    const raw = readConversationStorage()
    const parsed = raw ? JSON.parse(raw) : []
    const base = Array.isArray(parsed)
      ? (parsed.map(normalizeConversation).filter(Boolean) as ChatConversation[])
      : []
    const conversations = sortConversations(migrateLegacyDocumentConversations(base))

    window.localStorage.setItem(CONVERSATIONS_KEY, serializeConversations(conversations))
    window.localStorage.removeItem(LEGACY_CONVERSATIONS_KEY)
    return conversations
  } catch {
    return []
  }
}

export function saveConversations(conversations: ChatConversation[]) {
  window.localStorage.setItem(CONVERSATIONS_KEY, serializeConversations(conversations))
  window.localStorage.removeItem(LEGACY_CONVERSATIONS_KEY)
}

export function createConversation(
  fallbackTitle: string,
  overrides: Partial<ChatConversation> = {}
): ChatConversation {
  return normalizeConversation({
    id: overrides.id ?? genId(),
    title: overrides.title ?? fallbackTitle,
    titleSource: overrides.titleSource ?? "fallback",
    scope: overrides.scope ?? "general",
    contextAttachments: overrides.contextAttachments ?? [],
    messages: overrides.messages ?? [],
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    systemPrompt: overrides.systemPrompt,
    sampling: overrides.sampling,
    retrievalTopK: overrides.retrievalTopK,
  })!
}

export function replaceConversation(
  conversations: ChatConversation[],
  conversation: ChatConversation
) {
  const next = conversations.filter((item) => item.id !== conversation.id)
  return sortConversations([conversation, ...next])
}

export function patchConversation(
  conversations: ChatConversation[],
  id: string,
  updates: Partial<ChatConversation>
) {
  return sortConversations(
    conversations.map((conversation) =>
      conversation.id === id
        ? normalizeConversation({
            ...conversation,
            ...updates,
            id: conversation.id,
            updatedAt: Date.now(),
          })!
        : conversation
    )
  )
}

export function removeConversation(conversations: ChatConversation[], id: string) {
  return sortConversations(conversations.filter((conversation) => conversation.id !== id))
}

export function findDocumentConversation(
  conversations: ChatConversation[],
  documentId: string
) {
  return conversations.find(
    (conversation) =>
      conversation.scope === "document" &&
      conversation.contextAttachments.some(
        (attachment) => attachment.documentId === documentId
      )
  )
}

export function ensureDocumentConversation(
  conversations: ChatConversation[],
  attachment: ChatAttachment
) {
  const existing = findDocumentConversation(conversations, attachment.documentId)
  if (!existing) {
    const created = createConversation(attachment.title, {
      scope: "document",
      contextAttachments: [attachment],
      title: attachment.title,
      titleSource: "fallback",
    })
    return {
      conversation: created,
      conversations: replaceConversation(conversations, created),
      created: true,
    }
  }

  const shouldRefreshTitle =
    existing.titleSource !== "manual" &&
    (!existing.messages.length ||
      existing.title === existing.contextAttachments[0]?.title ||
      existing.title === attachment.documentId)

  const nextConversation = normalizeConversation({
    ...existing,
    contextAttachments: dedupeAttachments([
      attachment,
      ...existing.contextAttachments.filter(
        (item) => item.documentId !== attachment.documentId
      ),
    ]),
    title: shouldRefreshTitle ? attachment.title : existing.title,
    updatedAt: existing.updatedAt,
  })!

  return {
    conversation: nextConversation,
    conversations: replaceConversation(conversations, nextConversation),
    created: false,
  }
}

export function clearDocumentConversationLegacyStorage(documentId: string) {
  removeLegacyDocumentConversationStorage(documentId)
}

function isTauri() {
  return !!(window as any).__TAURI_INTERNALS__
}

function mergeSampling(
  base: LlmSamplingConfig | undefined,
  override: LlmSamplingConfig | undefined
) {
  const merged = {
    temperature: override?.temperature ?? base?.temperature,
    top_p: override?.top_p ?? base?.top_p,
    top_k: override?.top_k ?? base?.top_k,
    max_tokens: override?.max_tokens ?? base?.max_tokens,
  }

  return normalizeSamplingConfig(merged)
}

interface StreamRagChatArgs {
  messages: ChatRequestMessage[]
  attachments?: ChatAttachment[]
  topK?: number
  systemPrompt?: string
  sampling?: LlmSamplingConfig
  enableRetrieval?: boolean
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function inferImageMimeType(filename: string) {
  const lowered = filename.toLowerCase()
  if (lowered.endsWith(".png")) return "image/png"
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) return "image/jpeg"
  if (lowered.endsWith(".webp")) return "image/webp"
  if (lowered.endsWith(".gif")) return "image/gif"
  if (lowered.endsWith(".bmp")) return "image/bmp"
  return null
}

export function isImageAttachment(attachment: ChatAttachment) {
  return inferImageMimeType(attachment.filename) != null
}

export async function encodeImageAttachmentAsDataUrl(attachment: ChatAttachment) {
  const mimeType = inferImageMimeType(attachment.filename)
  if (!mimeType) {
    return null
  }

  const filePath = await api.getDocumentFilePath(attachment.documentId)
  const bytes = await readFile(filePath)
  return `data:${mimeType};base64,${toBase64(bytes)}`
}

export function renderPromptTemplate(
  template: string,
  values: Record<string, string>
) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? "")
}

export async function loadChatBehaviorSettings(): Promise<ChatBehaviorSettings> {
  const settings = await api.getAllAppSettings()
  const map = new Map(settings.map((item) => [item.key, item.value]))

  const thresholdRaw = map.get("chat.long_text_threshold")?.trim() ?? ""
  const parsedThreshold = Number(thresholdRaw)

  return {
    modelBehaviorDescription:
      map.get("chat.model_behavior_description") ||
      DEFAULT_CHAT_MODEL_BEHAVIOR_DESCRIPTION,
    documentAppendPrompt:
      map.get("chat.prompt.document_append") || DEFAULT_DOCUMENT_APPEND_PROMPT,
    longTextRagPrompt:
      map.get("chat.prompt.long_text_rag") || DEFAULT_LONG_TEXT_RAG_PROMPT,
    longTextThreshold:
      Number.isFinite(parsedThreshold) && parsedThreshold >= 400
        ? Math.floor(parsedThreshold)
        : 3000,
    defaultAlwaysIncludeFullDocument:
      map.get("chat.default_always_include_full_document") === "true",
  }
}

export async function generateConversationTitle(
  messages: Array<Pick<ChatMessage, "role" | "content">>,
  sampling?: LlmSamplingConfig
) {
  if (!isTauri()) {
    throw new Error("Tauri backend not available. Chat titles require the desktop app runtime.")
  }

  const providers = await api.getProviders()
  const chatProvider = getActiveProviderForType(providers, "chat")
  const chatModel = chatProvider ? getPrimaryModelForType(chatProvider, "chat") : null
  if (!chatProvider || !chatModel) {
    throw new Error("NO_ACTIVE_CHAT_CHANNEL")
  }

  const title = await invoke<string>("generate_chat_title", {
    request: {
      chatChannel: toOpenAiChannelConfig(chatProvider, chatModel),
      messages: messages
        .filter((message) => message.content.trim())
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
      samplingOverride: mergeSampling(
        {
          temperature: 0.2,
          max_tokens: 40,
        },
        sampling
      ),
    },
  })

  return sanitizeGeneratedTitle(title, "New Chat")
}

export async function* streamRagChat(
  args: StreamRagChatArgs,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  if (!isTauri()) {
    throw new Error("Tauri backend not available. RAG chat requires the desktop app runtime.")
  }

  const providers = await api.getProviders()
  const chatProvider = getActiveProviderForType(providers, "chat")
  const chatModel = chatProvider ? getPrimaryModelForType(chatProvider, "chat") : null
  if (!chatProvider || !chatModel) {
    throw new Error("NO_ACTIVE_CHAT_CHANNEL")
  }

  const enableRetrieval = args.enableRetrieval !== false

  const embedProvider = enableRetrieval
    ? getActiveProviderForType(providers, "embed")
    : null
  const embedModel = embedProvider ? getPrimaryModelForType(embedProvider, "embed") : null
  if (enableRetrieval && (!embedProvider || !embedModel)) {
    throw new Error("NO_ACTIVE_EMBED_CHANNEL")
  }

  const rerankProvider = getActiveProviderForType(providers, "rerank")
  const rerankModel = rerankProvider ? getPrimaryModelForType(rerankProvider, "rerank") : null

  const requestId = genId()

  const queue: ChatStreamEvent[] = []
  let notify: (() => void) | null = null
  let finished = false
  let streamError: Error | null = null

  const wake = () => {
    if (notify) {
      const current = notify
      notify = null
      current()
    }
  }

  const push = (event: ChatStreamEvent) => {
    queue.push(event)
    wake()
  }

  const unlistenChunk = await listen<any>(EVENT_CHAT_CHUNK, (event) => {
    const payload = event.payload as { requestId: string; delta: string }
    if (payload.requestId !== requestId) return
    push({ type: "delta", delta: payload.delta })
  })

  const unlistenDone = await listen<any>(EVENT_CHAT_DONE, (event) => {
    const payload = event.payload as { requestId: string; sources: ChatSource[] }
    if (payload.requestId !== requestId) return
    finished = true
    push({ type: "done", sources: payload.sources || [] })
  })

  const unlistenError = await listen<any>(EVENT_CHAT_ERROR, (event) => {
    const payload = event.payload as { requestId: string; message: string }
    if (payload.requestId !== requestId) return
    finished = true
    streamError = new Error(payload.message)
    wake()
  })

  const cancelBackendRequest = async () => {
    try {
      await invoke("cancel_rag_chat", { requestId })
    } catch {
      // ignore cancellation cleanup failures
    }
  }

  const handleAbort = () => {
    finished = true
    streamError = new DOMException("Aborted", "AbortError")
    void cancelBackendRequest()
    wake()
  }

  signal?.addEventListener("abort", handleAbort)

  try {
    await invoke("start_rag_chat", {
      request: {
        requestId,
        chatChannel: toOpenAiChannelConfig(chatProvider, chatModel),
        embedChannel: embedProvider && embedModel ? toOpenAiChannelConfig(embedProvider, embedModel) : null,
        rerankChannel:
          rerankProvider && rerankModel
            ? toOpenAiChannelConfig(rerankProvider, rerankModel)
            : null,
        messages: args.messages,
        attachments: args.attachments ?? [],
        enableRetrieval,
        topK: args.topK,
        systemPrompt: args.systemPrompt?.trim() || null,
        samplingOverride: normalizeSamplingConfig(args.sampling),
      },
    })

    while (true) {
      if (streamError) {
        throw streamError
      }

      if (queue.length > 0) {
        yield queue.shift()!
        continue
      }

      if (finished) {
        break
      }

      await new Promise<void>((resolve) => {
        notify = resolve
      })
    }
  } finally {
    signal?.removeEventListener("abort", handleAbort)
    await Promise.all([unlistenChunk(), unlistenDone(), unlistenError()])
    if (!finished) {
      await cancelBackendRequest()
    }
  }
}
