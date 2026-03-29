import { useState, useRef, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import {
  streamRagChat,
  genId,
  loadConversations,
  saveConversations,
  type ChatMessage,
  type ChatConversation,
  type ChatAttachment,
} from "@/lib/chat"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DocumentPicker } from "@/components/DocumentPicker"
import {
  Plus,
  SendHorizonal,
  Square,
  Paperclip,
  FileText,
  X,
  MessageSquare,
  Trash2,
  Bot,
  User,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function Chat() {
  const { t } = useTranslation("chat")
  const { toast } = useToast()

  // Conversations
  const [conversations, setConversations] = useState<ChatConversation[]>(() =>
    loadConversations()
  )
  const [activeId, setActiveId] = useState<string | null>(
    () => conversations[0]?.id ?? null
  )
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null

  // Chat state
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Right panel
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)

  const { data: previewContent } = useQuery({
    queryKey: ["parsedContent", previewDocId],
    queryFn: () => api.getParsedContent(previewDocId!),
    enabled: !!previewDocId,
  })

  // Persist conversations
  const persist = useCallback(
    (convs: ChatConversation[]) => {
      setConversations(convs)
      saveConversations(convs)
    },
    []
  )

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [activeConversation?.messages])

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto"
      const scrollH = inputRef.current.scrollHeight
      inputRef.current.style.height = Math.min(scrollH, 200) + "px"
    }
  }, [input])

  const createConversation = () => {
    const conv: ChatConversation = {
      id: genId(),
      title: t("new_chat"),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const next = [conv, ...conversations]
    persist(next)
    setActiveId(conv.id)
    setAttachments([])
    setInput("")
  }

  const deleteConversation = (id: string) => {
    const next = conversations.filter((c) => c.id !== id)
    persist(next)
    if (activeId === id) {
      setActiveId(next[0]?.id ?? null)
    }
  }

  const updateConversation = (id: string, updates: Partial<ChatConversation>) => {
    const next = conversations.map((c) =>
      c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
    )
    persist(next)
  }

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return

    // Create conversation if needed
    let convId = activeId
    if (!convId) {
      const conv: ChatConversation = {
        id: genId(),
        title: input.trim().slice(0, 50) || t("new_chat"),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const next = [conv, ...conversations]
      persist(next)
      setActiveId(conv.id)
      convId = conv.id
    }

    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      content: input.trim() || t("attachment_default_prompt"),
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    }

    // Get current messages for this conversation
    const currentConv = conversations.find((c) => c.id === convId)
    const currentMessages = currentConv?.messages ?? []
    const updatedMessages = [...currentMessages, userMsg]

    // Update title from first message
    const isFirst = currentMessages.length === 0
    if (isFirst) {
      updateConversation(convId, {
        messages: updatedMessages,
        title: input.trim().slice(0, 50) || t("new_chat"),
      })
    } else {
      updateConversation(convId, { messages: updatedMessages })
    }

    setInput("")
    setAttachments([])

    const requestAttachments =
      attachments.length > 0
        ? [...attachments]
        : [...currentMessages]
            .reverse()
            .find((message) => message.attachments && message.attachments.length > 0)
            ?.attachments ?? []

    // Stream response
    setIsStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller

    const assistantMsg: ChatMessage = {
      id: genId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    }

    try {
      let fullContent = ""
      let sources = assistantMsg.sources ?? []
      for await (const event of streamRagChat(
        {
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          attachments: requestAttachments,
        },
        controller.signal
      )) {
        if (event.type === "delta") {
          fullContent += event.delta
        } else {
          sources = event.sources
        }
        assistantMsg.content = fullContent
        assistantMsg.sources = sources

        // Update conversation with streaming content
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: [...updatedMessages, { ...assistantMsg }],
                  updatedAt: Date.now(),
                }
              : c
          )
        )
      }

      // Final persist
      const finalMessages = [
        ...updatedMessages,
        { ...assistantMsg, content: fullContent, sources },
      ]
      updateConversation(convId!, { messages: finalMessages })
    } catch (err: any) {
      if (err.name !== "AbortError") {
        const description =
          err.message === "NO_ACTIVE_CHAT_CHANNEL"
            ? t("no_provider.description")
            : err.message === "NO_ACTIVE_EMBED_CHANNEL"
              ? t("no_embed_provider.description")
              : err.message
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

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const removeAttachment = (docId: string) => {
    setAttachments((prev) => prev.filter((a) => a.documentId !== docId))
  }

  const messages = activeConversation?.messages ?? []

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - conversation list */}
      <div className="w-[260px] border-r bg-muted/30 flex flex-col shrink-0">
        <div className="p-3">
          <Button
            onClick={createConversation}
            variant="outline"
            className="w-full justify-start gap-2 h-10 bg-background hover:bg-accent"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            {t("new_chat")}
          </Button>
        </div>
        <div className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <MessageSquare className="h-8 w-8 text-muted-foreground/20 mb-3" />
              <p className="text-xs text-muted-foreground/60 text-center">
                {t("no_conversations_desc")}
              </p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm cursor-pointer transition-colors",
                  activeId === conv.id
                    ? "bg-background shadow-sm text-foreground font-medium"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
                onClick={() => {
                  setActiveId(conv.id)
                  setAttachments([])
                }}
              >
                <MessageSquare className="h-4 w-4 shrink-0 opacity-50" />
                <span className="flex-1 truncate">{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteConversation(conv.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-destructive/10 transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Center - chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                {t("no_messages")}
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                {t("no_messages_desc")}
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-6 px-4 space-y-5">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-3",
                    msg.role === "assistant" && "bg-muted/40 -mx-4 px-4 py-4 rounded-xl"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background border shadow-sm"
                    )}
                  >
                    {msg.role === "user" ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-xs font-semibold mb-1.5">
                      {msg.role === "user" ? t("role.user") : t("role.assistant")}
                    </p>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content}
                      {isStreaming &&
                        msg === messages[messages.length - 1] &&
                        msg.role === "assistant" && (
                          <span className="inline-block w-1.5 h-4 bg-primary rounded-sm animate-pulse ml-0.5 align-text-bottom" />
                        )}
                    </div>
                    {/* Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {msg.attachments.map((att) => (
                          <button
                            key={att.documentId}
                            onClick={() =>
                              setPreviewDocId(
                                previewDocId === att.documentId
                                  ? null
                                  : att.documentId
                              )
                            }
                            className={cn(
                              "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                              previewDocId === att.documentId
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "bg-background border-border hover:bg-accent"
                            )}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            {att.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {msg.sources.map((source) => (
                          <button
                            key={source.chunkId}
                            onClick={() => setPreviewDocId(source.documentId)}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border bg-background border-border hover:bg-accent"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            {source.documentTitle}
                            <span className="text-muted-foreground">
                              {t("sources.chunk", { index: source.chunkIndex + 1 })} · {(source.score * 100).toFixed(1)}%
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="p-4 pb-5">
          <div className="max-w-3xl mx-auto">
            {/* Attachment badges */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachments.map((att) => (
                  <Badge
                    key={att.documentId}
                    variant="secondary"
                    className="gap-1.5 pr-1.5 py-1"
                  >
                    <FileText className="h-3 w-3" />
                    <span className="max-w-[150px] truncate">{att.title}</span>
                    <button
                      onClick={() => removeAttachment(att.documentId)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {/* Unified input container */}
            <div className="flex items-end gap-0 rounded-xl border border-input bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background transition-shadow">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-10 w-10 m-1 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setPickerOpen(true)}
                title={t("attach_document")}
              >
                <Paperclip className="h-[18px] w-[18px]" />
              </Button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("input_placeholder")}
                rows={1}
                className="flex-1 resize-none bg-transparent py-3 text-sm placeholder:text-muted-foreground focus:outline-none min-h-[44px] max-h-[200px] overflow-y-auto"
              />
              {isStreaming ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-10 w-10 m-1 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleStop}
                >
                  <Square className="h-4 w-4 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="shrink-0 h-10 w-10 m-1 rounded-lg"
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                >
                  <SendHorizonal className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel - document preview */}
      {previewDocId && (
        <div className="w-96 border-l bg-card flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 h-12 border-b">
            <h3 className="text-sm font-semibold">{t("preview.title")}</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPreviewDocId(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {previewContent?.markdown_content ? (
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                {previewContent.markdown_content}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("preview.no_content")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Document picker dialog */}
      <DocumentPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={setAttachments}
        existingAttachments={attachments}
      />
    </div>
  )
}
