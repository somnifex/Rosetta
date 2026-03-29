import { channelStore, type ChannelConfig } from "./api"

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

export interface ChatConversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export type ChatStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; sources: ChatSource[] }

const CONVERSATIONS_KEY = "pdf-translate:chat-conversations"
const EVENT_CHAT_CHUNK = "rag-chat-chunk"
const EVENT_CHAT_DONE = "rag-chat-done"
const EVENT_CHAT_ERROR = "rag-chat-error"

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function loadConversations(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveConversations(conversations: ChatConversation[]) {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations))
}

function isTauri() {
  return !!(window as any).__TAURI_INTERNALS__
}

function getActiveChannel(channels: ChannelConfig[]): ChannelConfig | null {
  return channels.find((channel) => channel.isActive) || null
}

export function getActiveChatChannel() {
  return getActiveChannel(channelStore.getChatChannels())
}

export function getActiveEmbedChannel() {
  return getActiveChannel(channelStore.getEmbedChannels())
}

export function getActiveRerankChannel() {
  return getActiveChannel(channelStore.getRerankChannels())
}

interface StreamRagChatArgs {
  messages: { role: string; content: string }[]
  attachments?: ChatAttachment[]
  topK?: number
}

export async function* streamRagChat(
  args: StreamRagChatArgs,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  if (!isTauri()) {
    throw new Error("Tauri backend not available. RAG chat requires the desktop app runtime.")
  }

  const chatChannel = getActiveChatChannel()
  if (!chatChannel) {
    throw new Error("NO_ACTIVE_CHAT_CHANNEL")
  }

  const embedChannel = getActiveEmbedChannel()
  if (!embedChannel) {
    throw new Error("NO_ACTIVE_EMBED_CHANNEL")
  }

  const rerankChannel = getActiveRerankChannel()

  const requestId = genId()
  const { invoke } = await import("@tauri-apps/api/core")
  const { listen } = await import("@tauri-apps/api/event")

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
        chatChannel: chatChannel,
        embedChannel: embedChannel,
        rerankChannel: rerankChannel || null,
        messages: args.messages,
        attachments: args.attachments ?? [],
        topK: args.topK,
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
