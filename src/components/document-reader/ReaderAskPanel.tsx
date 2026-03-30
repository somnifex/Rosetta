import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  clearDocumentConversationLegacyStorage,
  ensureDocumentConversation,
  findDocumentConversation,
  genId,
  generateConversationTitle,
  loadChatBehaviorSettings,
  loadConversations,
  patchConversation,
  renderPromptTemplate,
  saveConversations,
  streamRagChat,
  type ChatConversation,
  type ChatMessage,
} from "@/lib/chat"
import {
  getActiveProviderForType,
  getPrimaryModelForType,
} from "@/lib/providers"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConversationSettingsDialog } from "@/components/chat/ConversationSettingsDialog"
import { ChatMarkdown } from "@/components/chat/ChatMarkdown"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  Bot,
  ExternalLink,
  MessageSquare,
  RotateCcw,
  SendHorizonal,
  Settings2,
  Sparkles,
  Square,
  User,
  X,
} from "lucide-react"

interface ReaderAskPanelProps {
  documentId: string
  documentTitle: string
  isOpen: boolean
  onToggle: () => void
  prefillText?: string
  onPrefillConsumed?: () => void
}

export function ReaderAskPanel({
  documentId,
  documentTitle,
  isOpen,
  onToggle,
  prefillText,
  onPrefillConsumed,
}: ReaderAskPanelProps) {
  const { t } = useTranslation("chat")
  const { toast } = useToast()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<ChatConversation[]>(() =>
    loadConversations()
  )
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [titleGenerating, setTitleGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  })

  const { data: chatBehaviorSettings } = useQuery({
    queryKey: ["chatBehaviorSettings"],
    queryFn: loadChatBehaviorSettings,
  })

  const activeChatProvider = getActiveProviderForType(providers, "chat")
  const activeChatModel = activeChatProvider
    ? getPrimaryModelForType(activeChatProvider, "chat")
    : null
  const activeModelLabel =
    activeChatProvider && activeChatModel
      ? `${activeChatProvider.name} / ${activeChatModel.model_name}`
      : undefined

  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) =>
          conversation.scope === "document" &&
          conversation.contextAttachments.some(
            (attachment) => attachment.documentId === documentId
          )
      ) ?? null,
    [conversations, documentId]
  )

  useEffect(() => {
    const current = loadConversations()
    const existing = findDocumentConversation(current, documentId)

    if (!existing && !isOpen && !prefillText) {
      setConversations(current)
      return
    }

    const ensured = ensureDocumentConversation(current, {
      documentId,
      title: documentTitle,
      filename: "",
    })
    setConversations(ensured.conversations)
    saveConversations(ensured.conversations)
    clearDocumentConversationLegacyStorage(documentId)
  }, [documentId, documentTitle, isOpen, prefillText])

  useEffect(() => {
    if (!isOpen) return
    const container = messagesContainerRef.current
    if (!container) return

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeConversation?.id, activeConversation?.messages.length, isOpen])

  useEffect(() => {
    if (prefillText && isOpen) {
      setInput(prefillText)
      inputRef.current?.focus()
      onPrefillConsumed?.()
    }
  }, [isOpen, onPrefillConsumed, prefillText])

  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.style.height = "auto"
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`
  }, [input])

  function persist(next: ChatConversation[]) {
    setConversations(next)
    saveConversations(next)
  }

  function updateConversation(updates: Partial<ChatConversation>) {
    if (!activeConversation) return
    persist(patchConversation(conversations, activeConversation.id, updates))
  }

  function updateConversationLive(updates: Partial<ChatConversation>) {
    if (!activeConversation) return
    setConversations((current) => {
      const next = patchConversation(current, activeConversation.id, updates)
      saveConversations(next)
      return next
    })
  }

  async function maybeGenerateTitle(finalMessages: ChatMessage[]) {
    if (!activeConversation) return
    const userCount = finalMessages.filter((message) => message.role === "user").length
    if (activeConversation.titleSource === "manual" || userCount !== 1) return

    setTitleGenerating(true)
    try {
      const title = await generateConversationTitle(finalMessages, activeConversation.sampling)
      updateConversation({
        title,
        titleSource: "ai",
      })
    } catch {
      updateConversation({
        title: documentTitle,
        titleSource: "fallback",
      })
    } finally {
      setTitleGenerating(false)
    }
  }

  async function handleSend() {
    if (!input.trim() || !activeConversation) return

    const effectiveBehavior = {
      documentAppendPrompt:
        chatBehaviorSettings?.documentAppendPrompt ||
        "用户问题：{{user_input}}\n\n以下是文档全文，请优先基于全文回答并在结论后指出关键依据：\n\n{{document_content}}",
      longTextRagPrompt:
        chatBehaviorSettings?.longTextRagPrompt ||
        "用户输入很长，请先给出结构化摘要，再按要点回答，必要时明确指出不确定性。\n\n原始输入：\n{{user_input}}",
      longTextThreshold: chatBehaviorSettings?.longTextThreshold ?? 3000,
      defaultAlwaysIncludeFullDocument:
        chatBehaviorSettings?.defaultAlwaysIncludeFullDocument ?? false,
    }

    const alwaysIncludeFullDocument =
      activeConversation.alwaysIncludeFullDocument ??
      effectiveBehavior.defaultAlwaysIncludeFullDocument

    const fetchDocumentFullContent = async () => {
      try {
        const parsed = await api.getParsedContent(documentId)
        if (parsed?.markdown_content?.trim()) return parsed.markdown_content
      } catch {
        // ignore parsed-content fetch failures
      }

      try {
        const translated = await api.getTranslatedContent(documentId)
        if (translated?.content?.trim()) return translated.content
      } catch {
        // ignore translated-content fetch failures
      }

      return ""
    }

    let requestUserContent = input.trim()

    if (alwaysIncludeFullDocument) {
      const fullDocument = await fetchDocumentFullContent()
      if (fullDocument.length > effectiveBehavior.longTextThreshold) {
        requestUserContent = renderPromptTemplate(effectiveBehavior.longTextRagPrompt, {
          user_input: input.trim(),
        })
        toast({
          title: t("composer.long_text_rag_enabled"),
          description: t("composer.long_text_rag_enabled_desc"),
        })
      } else if (fullDocument.trim()) {
        requestUserContent = renderPromptTemplate(effectiveBehavior.documentAppendPrompt, {
          user_input: input.trim(),
          document_content: fullDocument,
        })
      }
    }

    const userMessage: ChatMessage = {
      id: genId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    }

    const updatedMessages = [...activeConversation.messages, userMessage]
    updateConversation({
      messages: updatedMessages,
      title:
        activeConversation.messages.length === 0 &&
        activeConversation.titleSource !== "manual"
          ? documentTitle
          : activeConversation.title,
    })
    setInput("")

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
            content:
              message.id === userMessage.id
                ? requestUserContent
                : message.content,
          })),
          attachments: activeConversation.contextAttachments,
          enableRetrieval: true,
          topK: activeConversation.retrievalTopK,
          systemPrompt: activeConversation.systemPrompt,
          sampling: activeConversation.sampling,
        },
        controller.signal
      )) {
        if (event.type === "delta") {
          fullContent += event.delta
        } else {
          sources = event.sources
        }

        updateConversationLive({
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
      updateConversation({ messages: finalMessages })
      await maybeGenerateTitle(finalMessages)
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const description =
          error.message === "NO_ACTIVE_CHAT_CHANNEL"
            ? t("no_provider.description")
            : error.message === "NO_ACTIVE_EMBED_CHANNEL"
              ? t("no_embed_provider.description")
              : error.message

        toast({
          title: t("document_panel.error_title"),
          description,
          variant: "destructive",
        })
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  function handleClear() {
    if (!activeConversation) return
    updateConversation({
      messages: [],
      title: documentTitle,
      titleSource: "fallback",
    })
  }

  const messages = activeConversation?.messages ?? []

  return (
    <>
      <aside
        className={cn(
          "glass-surface border-l flex flex-col min-h-0",
          isOpen ? "w-[400px] shrink-0" : "w-0 overflow-hidden border-l-0"
        )}
      >
        <div className="flex h-full flex-col flex-1 min-h-0">
          <div className="shrink-0 border-b border-border/60 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-4 w-4" />
                  {t("document_panel.title")}
                  {titleGenerating ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("document_panel.generating_title")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("document_panel.subtitle")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full bg-background/70">
                    {t("scope.document")}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="max-w-[220px] truncate rounded-full bg-background/70"
                  >
                    {documentTitle}
                  </Badge>
                  {activeConversation?.systemPrompt ? (
                    <Badge variant="outline" className="rounded-full bg-background/70">
                      {t("settings.system_prompt_badge")}
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={() => setSettingsOpen(true)}
                  title={t("settings.title")}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={() =>
                    navigate("/chat", {
                      state: { conversationId: activeConversation?.id },
                    })
                  }
                  title={t("document_panel.open_history")}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                {messages.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-xl"
                    onClick={handleClear}
                    title={t("document_panel.reset")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={onToggle}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div ref={messagesContainerRef} className="flex-1 overflow-auto min-h-0">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 rounded-[28px] border border-primary/10 bg-primary/5 p-5 shadow-sm">
                  <Bot className="mx-auto h-10 w-10 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("document_panel.empty_desc")}
                </p>
                <div className="mt-5 grid w-full gap-2 text-left">
                  {[
                    t("document_panel.suggestion_1"),
                    t("document_panel.suggestion_2"),
                    t("document_panel.suggestion_3"),
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="desktop-panel rounded-2xl border border-border/70 px-4 py-3 text-sm transition-transform hover:-translate-y-0.5"
                      onClick={() => setInput(suggestion)}
                    >
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{suggestion}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3",
                      message.role === "assistant" &&
                        "desktop-panel rounded-2xl border border-border/70 p-3"
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border bg-background"
                      )}
                    >
                      {message.role === "user" ? (
                        <User className="h-4 w-4" />
                      ) : (
                        <Bot className="h-4 w-4 text-primary" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="min-w-0 flex-1">
                        <ChatMarkdown content={message.content + (isStreaming && message === messages[messages.length - 1] && message.role === "assistant" ? " ▍" : "")} />
                      </div>
                      {message.role === "assistant" &&
                      message.sources &&
                      message.sources.length > 0 ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {t("sources.label")}
                          </p>
                          {message.sources.map((source) => (
                            <div key={source.chunkId} className="text-xs text-muted-foreground">
                              [{source.documentTitle}]{" "}
                              {t("sources.chunk", { index: source.chunkIndex + 1 })} ·{" "}
                              {(source.score * 100).toFixed(1)}%
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t("document_panel.composer_shortcut")}</span>
              <span>
                {isStreaming
                  ? t("document_panel.streaming_hint")
                  : t("document_panel.ready_hint")}
              </span>
            </div>

            <div className="desktop-panel flex items-end gap-0 rounded-2xl border border-border/70 bg-background/85 p-1 focus-within:ring-2 focus-within:ring-ring">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
                rows={1}
                placeholder={t("document_panel.placeholder")}
                className="min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm focus:outline-none"
              />
              {isStreaming ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="m-1 h-9 w-9 shrink-0 rounded-lg text-destructive"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square className="h-4 w-4 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="m-1 h-9 w-9 shrink-0 rounded-lg"
                  onClick={() => void handleSend()}
                  disabled={!input.trim()}
                >
                  <SendHorizonal className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </aside>

      <ConversationSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        conversation={activeConversation}
        activeModelLabel={activeModelLabel}
        onChange={(updates) => {
          if (!activeConversation) return
          persist(patchConversation(conversations, activeConversation.id, updates))
        }}
      />
    </>
  )
}
