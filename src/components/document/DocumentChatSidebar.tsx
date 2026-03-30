import { useState, useRef, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { streamRagChat, genId, type ChatMessage } from "@/lib/chat"
import { Button } from "@/components/ui/button"
import { ChatMarkdown } from "@/components/chat/ChatMarkdown"
import { MessageSquare, X, SendHorizonal, Square, Bot, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useResizableRightPanel } from "@/hooks/useResizableRightPanel"

interface DocumentChatSidebarProps {
  documentId: string
  documentTitle: string
  documentContent?: string
  isOpen: boolean
  onToggle: () => void
  prefillText?: string
  onPrefillConsumed?: () => void
}

const STORAGE_PREFIX = "pdf-translate:document-chat:"

function loadMessages(docId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + docId)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveMessages(docId: string, messages: ChatMessage[]) {
  localStorage.setItem(STORAGE_PREFIX + docId, JSON.stringify(messages))
}

export function DocumentChatSidebar({
  documentId,
  documentTitle,
  documentContent,
  isOpen,
  onToggle,
  prefillText,
  onPrefillConsumed,
}: DocumentChatSidebarProps) {
  const { t } = useTranslation("document")
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(documentId))
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const {
    panelStyle,
    isResizing,
    startResize,
  } = useResizableRightPanel({
    defaultWidth: 380,
    minWidth: 320,
    maxWidth: 760,
    storageKey: "rosetta:document-chat-sidebar-width",
  })

  // Persist messages
  useEffect(() => {
    saveMessages(documentId, messages)
  }, [documentId, messages])

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Handle prefill text from text selection
  useEffect(() => {
    if (prefillText && isOpen) {
      setInput(prefillText)
      onPrefillConsumed?.()
      inputRef.current?.focus()
    }
  }, [prefillText, isOpen, onPrefillConsumed])

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto"
      const scrollH = inputRef.current.scrollHeight
      inputRef.current.style.height = Math.min(scrollH, 150) + "px"
    }
  }, [input])

  const handleSend = useCallback(async () => {
    if (!input.trim()) return

    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    }

    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput("")

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
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          attachments: [
            {
              documentId,
              title: documentTitle,
              filename: "",
            },
          ],
        },
        controller.signal
      )) {
        if (event.type === "delta") {
          fullContent += event.delta
        } else {
          sources = event.sources
        }
        setMessages([
          ...updatedMessages,
          { ...assistantMsg, content: fullContent, sources },
        ])
      }
      setMessages([
        ...updatedMessages,
        { ...assistantMsg, content: fullContent, sources },
      ])
    } catch (err: any) {
      if (err.name !== "AbortError") {
        const description =
          err.message === "NO_ACTIVE_CHAT_CHANNEL"
            ? t("chat.no_provider")
            : err.message === "NO_ACTIVE_EMBED_CHANNEL"
              ? t("chat.no_embed_provider")
              : err.message
        toast({
          title: t("chat.error"),
          description,
          variant: "destructive",
        })
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, messages, documentTitle, documentContent, toast, t])

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleClear = () => {
    setMessages([])
    localStorage.removeItem(STORAGE_PREFIX + documentId)
  }

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="icon"
        className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-10"
        onClick={onToggle}
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
    )
  }

  return (
    <div className="relative flex shrink-0 flex-col border-l bg-card" style={panelStyle}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize document chat sidebar"
        className={cn(
          "absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize",
          isResizing ? "bg-primary/15" : "hover:bg-primary/10"
        )}
        onPointerDown={startResize}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b shrink-0">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          {t("chat.title")}
        </h3>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleClear}>
              {t("chat.clear")}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bot className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">{t("chat.empty")}</p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex gap-2", msg.role === "assistant" && "bg-muted/40 -mx-3 px-3 py-2 rounded-lg")}>
                <div
                  className={cn(
                    "h-6 w-6 rounded-md flex items-center justify-center shrink-0 mt-0.5",
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-background border"
                  )}
                >
                  {msg.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm leading-relaxed min-w-0 flex-1">
                    <ChatMarkdown content={msg.content + (isStreaming && msg === messages[messages.length - 1] && msg.role === "assistant" ? " ▍" : "")} />
                  </div>
                  {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t("sources.label")}
                      </p>
                      {msg.sources.map((source) => (
                        <div key={source.chunkId} className="text-xs text-muted-foreground">
                          [{source.documentTitle}] {t("sources.chunk", { index: source.chunkIndex + 1 })} · {(source.score * 100).toFixed(1)}%
                        </div>
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

      {/* Input */}
      <div className="p-3 border-t shrink-0">
        <div className="flex items-end gap-0 rounded-lg border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={t("chat.input_placeholder")}
            rows={1}
            className="flex-1 resize-none bg-transparent py-2.5 px-3 text-sm placeholder:text-muted-foreground focus:outline-none min-h-[38px] max-h-[150px] overflow-y-auto"
          />
          {isStreaming ? (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-9 w-9 m-0.5 rounded-md text-destructive"
              onClick={handleStop}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="shrink-0 h-9 w-9 m-0.5 rounded-md"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <SendHorizonal className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
