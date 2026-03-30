import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "react-router-dom"
import { api } from "@/lib/api"
import {
  conversationMatchesQuery,
  createConversation,
  deriveConversationTitleCandidate,
  findDocumentConversation,
  genId,
  generateConversationTitle,
  getConversationPreview,
  loadConversations,
  patchConversation,
  removeConversation,
  replaceConversation,
  saveConversations,
  streamRagChat,
  type ChatAttachment,
  type ChatConversation,
  type ChatMessage,
} from "@/lib/chat"
import {
  getActiveProviderForType,
  getPrimaryModelForType,
} from "@/lib/providers"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { DocumentPicker } from "@/components/DocumentPicker"
import { ConversationSettingsDialog } from "@/components/chat/ConversationSettingsDialog"
import {
  Bot,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  SendHorizonal,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

function dedupeAttachments(attachments: ChatAttachment[]) {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    if (seen.has(attachment.documentId)) return false
    seen.add(attachment.documentId)
    return true
  })
}

function formatConversationTime(timestamp: number) {
  const value = new Date(timestamp)
  return value.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function Chat() {
  const { t } = useTranslation("chat")
  const { toast } = useToast()
  const location = useLocation()

  const [conversations, setConversations] = useState<ChatConversation[]>(() =>
    loadConversations()
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [historyQuery, setHistoryQuery] = useState("")
  const [titleGeneratingId, setTitleGeneratingId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const deferredHistoryQuery = useDeferredValue(historyQuery)
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ?? null

  const { data: previewContent } = useQuery({
    queryKey: ["parsedContent", previewDocId],
    queryFn: () => api.getParsedContent(previewDocId!),
    enabled: !!previewDocId,
  })

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  })

  const activeChatProvider = getActiveProviderForType(providers, "chat")
  const activeChatModel = activeChatProvider
    ? getPrimaryModelForType(activeChatProvider, "chat")
    : null
  const activeModelLabel =
    activeChatProvider && activeChatModel
      ? `${activeChatProvider.name} / ${activeChatModel.model_name}`
      : undefined

  const filteredConversations = useMemo(
    () =>
      conversations.filter((conversation) =>
        conversationMatchesQuery(conversation, deferredHistoryQuery)
      ),
    [conversations, deferredHistoryQuery]
  )

  useEffect(() => {
    if (!activeId && conversations[0]) {
      setActiveId(conversations[0].id)
    }
  }, [activeId, conversations])

  useEffect(() => {
    if (activeId && !conversations.some((conversation) => conversation.id === activeId)) {
      setActiveId(conversations[0]?.id ?? null)
    }
  }, [activeId, conversations])

  useEffect(() => {
    const targetId = (location.state as { conversationId?: string } | null)?.conversationId
    if (
      targetId &&
      targetId !== activeId &&
      conversations.some((conversation) => conversation.id === targetId)
    ) {
      openConversation(targetId)
    }
  }, [activeId, conversations, location.state])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [activeConversation?.id, activeConversation?.messages.length])

  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.style.height = "auto"
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 220)}px`
  }, [input])

  function persist(next: ChatConversation[]) {
    setConversations(next)
    saveConversations(next)
  }

  function applyConversationUpdates(id: string, updates: Partial<ChatConversation>) {
    const next = patchConversation(conversations, id, updates)
    persist(next)
  }

  function applyConversationUpdatesLive(
    id: string,
    updates: Partial<ChatConversation>
  ) {
    setConversations((current) => {
      const next = patchConversation(current, id, updates)
      saveConversations(next)
      return next
    })
  }

  function openConversation(id: string) {
    startTransition(() => {
      setActiveId(id)
      setAttachments([])
      setPreviewDocId(null)
      setInput("")
    })
  }

  function handleCreateConversation() {
    const conversation = createConversation(t("new_chat"), {
      title: t("new_chat"),
      titleSource: "fallback",
      scope: "general",
    })
    const next = replaceConversation(conversations, conversation)
    persist(next)
    openConversation(conversation.id)
  }

  function handleDeleteConversation(id: string) {
    const next = removeConversation(conversations, id)
    persist(next)
    if (titleGeneratingId === id) {
      setTitleGeneratingId(null)
    }
  }

  async function maybeGenerateTitle(
    conversation: ChatConversation,
    finalMessages: ChatMessage[]
  ) {
    const userMessageCount = finalMessages.filter((message) => message.role === "user").length
    if (conversation.titleSource === "manual" || userMessageCount !== 1) return

    const fallbackTitle = deriveConversationTitleCandidate(
      finalMessages.find((message) => message.role === "user")?.content ?? "",
      t("new_chat")
    )

    setTitleGeneratingId(conversation.id)
    try {
      const title = await generateConversationTitle(finalMessages, conversation.sampling)
      applyConversationUpdates(conversation.id, {
        title,
        titleSource: "ai",
      })
    } catch {
      applyConversationUpdates(conversation.id, {
        title: fallbackTitle,
        titleSource: "fallback",
      })
    } finally {
      setTitleGeneratingId((current) =>
        current === conversation.id ? null : current
      )
    }
  }

  async function handleSend() {
    if (!input.trim() && attachments.length === 0) return

    let conversation = activeConversation
    let nextConversations = conversations
    if (!conversation) {
      conversation = createConversation(t("new_chat"), {
        title: t("new_chat"),
        titleSource: "fallback",
        scope: "general",
      })
      nextConversations = replaceConversation(nextConversations, conversation)
      persist(nextConversations)
      setActiveId(conversation.id)
    }

    const messageContent = input.trim() || t("attachment_default_prompt")
    const composerAttachments =
      conversation.scope === "document" ? [] : [...attachments]

    const userMessage: ChatMessage = {
      id: genId(),
      role: "user",
      content: messageContent,
      timestamp: Date.now(),
      attachments:
        composerAttachments.length > 0 ? dedupeAttachments(composerAttachments) : undefined,
    }

    const updatedMessages = [...conversation.messages, userMessage]
    const fallbackTitle =
      conversation.titleSource === "manual"
        ? conversation.title
        : deriveConversationTitleCandidate(messageContent, t("new_chat"))

    const requestAttachments = dedupeAttachments([
      ...conversation.contextAttachments,
      ...composerAttachments,
      ...(!conversation.contextAttachments.length && composerAttachments.length === 0
        ? updatedMessages
            .slice(0, -1)
            .reverse()
            .find((message) => (message.attachments ?? []).length > 0)
            ?.attachments ?? []
        : []),
    ])

    applyConversationUpdates(conversation.id, {
      messages: updatedMessages,
      title:
        conversation.messages.length === 0 && conversation.titleSource !== "manual"
          ? fallbackTitle
          : conversation.title,
      titleSource:
        conversation.messages.length === 0 && conversation.titleSource !== "manual"
          ? "fallback"
          : conversation.titleSource,
    })

    setInput("")
    setAttachments([])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    const assistantMessage: ChatMessage = {
      id: genId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    }

    try {
      let fullContent = ""
      let sources = assistantMessage.sources ?? []

      for await (const event of streamRagChat(
        {
          messages: updatedMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          attachments: requestAttachments,
          topK: conversation.retrievalTopK,
          systemPrompt: conversation.systemPrompt,
          sampling: conversation.sampling,
        },
        controller.signal
      )) {
        if (event.type === "delta") {
          fullContent += event.delta
        } else {
          sources = event.sources
        }

        applyConversationUpdatesLive(conversation.id, {
          messages: [
            ...updatedMessages,
            {
              ...assistantMessage,
              content: fullContent,
              sources,
            },
          ],
        })
      }

      const finalMessages = [
        ...updatedMessages,
        {
          ...assistantMessage,
          content: fullContent,
          sources,
        },
      ]
      applyConversationUpdates(conversation.id, {
        messages: finalMessages,
      })
      await maybeGenerateTitle(conversation, finalMessages)
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const description =
          error.message === "NO_ACTIVE_CHAT_CHANNEL"
            ? t("no_provider.description")
            : error.message === "NO_ACTIVE_EMBED_CHANNEL"
              ? t("no_embed_provider.description")
              : error.message

        toast({
          title: t("error.stream_failed"),
          description,
          variant: "destructive",
        })
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  function handleRemoveAttachment(documentId: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.documentId !== documentId)
    )
  }

  function handleConversationSettingsChange(updates: Partial<ChatConversation>) {
    if (!activeConversation) return
    applyConversationUpdates(activeConversation.id, updates)
  }

  const activeMessages = activeConversation?.messages ?? []
  const contextAttachments = activeConversation?.contextAttachments ?? []

  return (
    <>
      <div className="relative flex h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-140px] top-[-80px] h-[320px] w-[320px] rounded-full bg-sky-200/35 blur-3xl" />
          <div className="absolute bottom-[-100px] right-[-70px] h-[280px] w-[280px] rounded-full bg-cyan-200/25 blur-3xl" />
        </div>

        <aside className="relative z-10 flex w-[320px] shrink-0 flex-col border-r border-border/60 bg-white/70 backdrop-blur-xl">
          <div className="border-b border-border/60 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t("history.label")}
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight">
                  {t("title")}
                </h1>
              </div>
              <Button
                size="icon"
                className="h-11 w-11 rounded-2xl shadow-[0_18px_40px_rgba(37,99,235,0.18)]"
                onClick={handleCreateConversation}
                title={t("new_chat")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder={t("history.search_placeholder")}
                className="h-11 rounded-2xl border-border/70 bg-background/85 pl-10 shadow-sm"
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("history.count", { count: conversations.length })}</span>
              {deferredHistoryQuery.trim() ? (
                <span>{t("history.results", { count: filteredConversations.length })}</span>
              ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-3 py-3">
            {filteredConversations.length === 0 ? (
              <div className="desktop-panel flex h-full flex-col items-center justify-center rounded-[28px] border border-border/60 px-6 text-center">
                <MessageSquare className="mb-4 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium">{t("history.empty_title")}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {deferredHistoryQuery.trim()
                    ? t("history.empty_search")
                    : t("no_conversations_desc")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => openConversation(conversation.id)}
                    className={cn(
                      "desktop-panel group flex w-full flex-col items-start gap-3 rounded-[24px] border px-4 py-4 text-left transition-all",
                      activeId === conversation.id
                        ? "border-primary/20 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.16)]"
                        : "border-border/60 hover:-translate-y-0.5 hover:border-primary/15"
                    )}
                  >
                    <div className="flex w-full items-start gap-3">
                      <div
                        className={cn(
                          "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                          conversation.scope === "document"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-sky-100 text-sky-700"
                        )}
                      >
                        {conversation.scope === "document" ? (
                          <FileText className="h-4 w-4" />
                        ) : (
                          <MessageSquare className="h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">
                            {conversation.title}
                          </p>
                          {titleGeneratingId === conversation.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {getConversationPreview(conversation) || t("history.no_preview")}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDeleteConversation(conversation.id)
                        }}
                        className="rounded-xl p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                        title={t("history.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-full bg-background/80">
                          {conversation.scope === "document"
                            ? t("scope.document")
                            : t("scope.general")}
                        </Badge>
                        {conversation.contextAttachments[0] ? (
                          <Badge
                            variant="outline"
                            className="max-w-[160px] truncate rounded-full bg-background/80"
                          >
                            {conversation.contextAttachments[0].title}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatConversationTime(conversation.updatedAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="relative z-10 flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border/60 bg-white/55 px-5 py-4 backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-semibold tracking-tight">
                    {activeConversation?.title ?? t("new_chat")}
                  </h2>
                  {activeConversation ? (
                    <Badge variant="outline" className="rounded-full bg-background/80">
                      {activeConversation.scope === "document"
                        ? t("scope.document")
                        : t("scope.general")}
                    </Badge>
                  ) : null}
                  {activeConversation?.systemPrompt ? (
                    <Badge variant="outline" className="rounded-full bg-background/80">
                      {t("settings.system_prompt_badge")}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeConversation
                    ? activeConversation.scope === "document" &&
                      activeConversation.contextAttachments[0]
                      ? t("header.document_context", {
                          document: activeConversation.contextAttachments[0].title,
                        })
                      : t("header.general_context")
                    : t("header.no_active")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="rounded-full bg-background/80"
                  onClick={() => setPickerOpen(true)}
                  disabled={activeConversation?.scope === "document"}
                >
                  <Paperclip className="mr-2 h-4 w-4" />
                  {t("attach_document")}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full bg-background/80"
                  onClick={() => setSettingsOpen(true)}
                  disabled={!activeConversation}
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  {t("settings.title")}
                </Button>
              </div>
            </div>

            {contextAttachments.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {contextAttachments.map((attachment) => (
                  <Badge
                    key={attachment.documentId}
                    variant="outline"
                    className="gap-2 rounded-full bg-background/80 px-3 py-1.5"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span className="max-w-[240px] truncate">{attachment.title}</span>
                  </Badge>
                ))}
              </div>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="flex-1 overflow-auto px-5 py-5">
                {activeMessages.length === 0 ? (
                  <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
                    <div className="desktop-panel rounded-[32px] border border-border/60 px-8 py-10 shadow-[0_28px_80px_rgba(15,23,42,0.12)]">
                      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] bg-sky-100 text-sky-700">
                        <Bot className="h-9 w-9" />
                      </div>
                      <h3 className="text-2xl font-semibold tracking-tight">
                        {t("empty.title")}
                      </h3>
                      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                        {activeConversation?.scope === "document"
                          ? t("empty.document_desc")
                          : t("empty.general_desc")}
                      </p>
                      <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
                        {(activeConversation?.scope === "document"
                          ? [
                              t("empty.suggestion_document_1"),
                              t("empty.suggestion_document_2"),
                              t("empty.suggestion_document_3"),
                              t("empty.suggestion_document_4"),
                            ]
                          : [
                              t("empty.suggestion_general_1"),
                              t("empty.suggestion_general_2"),
                              t("empty.suggestion_general_3"),
                              t("empty.suggestion_general_4"),
                            ]).map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => setInput(suggestion)}
                            className="rounded-[24px] border border-border/70 bg-background/80 px-4 py-4 text-sm transition hover:-translate-y-0.5 hover:border-primary/20"
                          >
                            <div className="flex items-start gap-3">
                              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                              <span>{suggestion}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-5">
                    {activeMessages.map((message, index) => (
                      <div
                        key={message.id}
                        className={cn(
                          "flex gap-4",
                          message.role === "assistant" &&
                            "desktop-panel rounded-[28px] border border-border/60 px-4 py-4"
                        )}
                      >
                        <div
                          className={cn(
                            "mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : message.role === "system"
                                ? "bg-amber-100 text-amber-700"
                                : "border border-border/70 bg-background text-primary"
                          )}
                        >
                          {message.role === "user" ? (
                            <User className="h-4 w-4" />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <p className="text-sm font-semibold">
                              {message.role === "user"
                                ? t("role.user")
                                : message.role === "system"
                                  ? t("role.system")
                                  : t("role.assistant")}
                            </p>
                            <span className="text-xs text-muted-foreground">
                              {formatConversationTime(message.timestamp)}
                            </span>
                          </div>

                          <div className="whitespace-pre-wrap break-words text-sm leading-7">
                            {message.content}
                            {isStreaming &&
                            index === activeMessages.length - 1 &&
                            message.role === "assistant" ? (
                              <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-text-bottom" />
                            ) : null}
                          </div>

                          {message.attachments?.length ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {message.attachments.map((attachment) => (
                                <button
                                  key={attachment.documentId}
                                  type="button"
                                  onClick={() =>
                                    setPreviewDocId((current) =>
                                      current === attachment.documentId
                                        ? null
                                        : attachment.documentId
                                    )
                                  }
                                  className={cn(
                                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                                    previewDocId === attachment.documentId
                                      ? "border-primary/25 bg-primary/10 text-primary"
                                      : "border-border/70 bg-background/80 hover:border-primary/15"
                                  )}
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  {attachment.title}
                                </button>
                              ))}
                            </div>
                          ) : null}

                          {message.sources?.length ? (
                            <div className="mt-4 space-y-2">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                {t("sources.label")}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {message.sources.map((source) => (
                                  <button
                                    key={source.chunkId}
                                    type="button"
                                    onClick={() => setPreviewDocId(source.documentId)}
                                    className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium transition hover:border-primary/15"
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    <span>{source.documentTitle}</span>
                                    <span className="text-muted-foreground">
                                      {t("sources.chunk", {
                                        index: source.chunkIndex + 1,
                                      })}{" "}
                                      · {(source.score * 100).toFixed(1)}%
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="border-t border-border/60 bg-white/55 px-5 py-4 backdrop-blur-xl">
                <div className="mx-auto max-w-3xl">
                  {attachments.length ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {attachments.map((attachment) => (
                        <Badge
                          key={attachment.documentId}
                          variant="outline"
                          className="gap-2 rounded-full bg-background/80 px-3 py-1.5"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span className="max-w-[180px] truncate">{attachment.title}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(attachment.documentId)}
                            className="rounded-full p-0.5 hover:bg-muted"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("composer.shortcut")}</span>
                    <span>
                      {activeConversation?.retrievalTopK
                        ? t("composer.retrieval_top_k", {
                            count: activeConversation.retrievalTopK,
                          })
                        : t("composer.retrieval_default")}
                    </span>
                  </div>

                  <div className="desktop-panel flex items-end gap-0 rounded-[28px] border border-border/70 bg-background/85 p-1.5">
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      disabled={activeConversation?.scope === "document"}
                      className="m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      title={t("attach_document")}
                    >
                      <Paperclip className="h-5 w-5" />
                    </button>

                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={1}
                      placeholder={
                        activeConversation?.scope === "document"
                          ? t("composer.document_placeholder")
                          : t("input_placeholder")
                      }
                      className="min-h-[52px] flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-7 placeholder:text-muted-foreground focus:outline-none"
                    />

                    {isStreaming ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="m-1 h-11 w-11 shrink-0 rounded-2xl text-destructive hover:bg-destructive/10"
                        onClick={handleStop}
                      >
                        <Square className="h-4 w-4 fill-current" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        className="m-1 h-11 w-11 shrink-0 rounded-2xl shadow-[0_18px_40px_rgba(37,99,235,0.22)]"
                        onClick={() => void handleSend()}
                        disabled={!input.trim() && attachments.length === 0}
                      >
                        <SendHorizonal className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </main>

            {previewDocId ? (
              <aside className="glass-surface hidden w-[360px] shrink-0 border-l border-border/60 xl:flex xl:flex-col">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">{t("preview.title")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("preview.description")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-2xl"
                    onClick={() => setPreviewDocId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {previewContent?.markdown_content ? (
                    <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                      {previewContent.markdown_content}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {t("preview.no_content")}
                    </p>
                  )}
                </div>
              </aside>
            ) : null}
          </div>
        </section>
      </div>

      <ConversationSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        conversation={activeConversation}
        activeModelLabel={activeModelLabel}
        onChange={handleConversationSettingsChange}
      />

      <DocumentPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={(nextAttachments) => {
          if (activeConversation) {
            const existingDocumentConversation = nextAttachments.find((attachment) =>
              findDocumentConversation(conversations, attachment.documentId)
            )
            if (existingDocumentConversation && activeConversation.scope !== "document") {
              toast({
                title: t("history.document_conversation_exists"),
                description: t("history.document_conversation_hint"),
              })
            }
          }
          setAttachments(nextAttachments)
        }}
        existingAttachments={attachments}
      />
    </>
  )
}
