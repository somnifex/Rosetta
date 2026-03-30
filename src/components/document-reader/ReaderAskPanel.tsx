import { useCallback, useEffect, useRef, useState } from "react"
import { streamRagChat, genId, type ChatMessage } from "@/lib/chat"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { Bot, MessageSquare, RotateCcw, SendHorizonal, Sparkles, Square, User, X } from "lucide-react"

interface ReaderAskPanelProps {
  documentId: string
  documentTitle: string
  isOpen: boolean
  onToggle: () => void
  prefillText?: string
  onPrefillConsumed?: () => void
}

const STORAGE_PREFIX = "rosetta:reader-chat:"

function loadMessages(documentId: string): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${documentId}`)
    return raw ? JSON.parse(raw) as ChatMessage[] : []
  } catch {
    return []
  }
}

function saveMessages(documentId: string, messages: ChatMessage[]) {
  window.localStorage.setItem(`${STORAGE_PREFIX}${documentId}`, JSON.stringify(messages))
}

export function ReaderAskPanel({
  documentId,
  documentTitle,
  isOpen,
  onToggle,
  prefillText,
  onPrefillConsumed,
}: ReaderAskPanelProps) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(documentId))
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setMessages(loadMessages(documentId))
  }, [documentId])

  useEffect(() => {
    saveMessages(documentId, messages)
  }, [documentId, messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

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

  const handleSend = useCallback(async () => {
    if (!input.trim()) return

    const userMessage: ChatMessage = {
      id: genId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
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
            content: message.content,
          })),
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
          {
            ...assistantMessage,
            content: fullContent,
            sources,
          },
        ])
      }

      setMessages([
        ...updatedMessages,
        {
          ...assistantMessage,
          content: fullContent,
          sources,
        },
      ])
    } catch (error: any) {
      if (error.name !== "AbortError") {
        toast({
          title: "文档问答失败",
          description: error.message,
          variant: "destructive",
        })
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [documentId, documentTitle, input, messages, toast])

  const handleStop = () => abortRef.current?.abort()
  const handleClear = () => {
    setMessages([])
    window.localStorage.removeItem(`${STORAGE_PREFIX}${documentId}`)
  }

  return (
    <aside
      className={cn(
        "glass-surface border-l transition-all duration-200",
        isOpen ? "w-[380px] shrink-0" : "w-0 overflow-hidden border-l-0"
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4" />
              文档问答
            </p>
            <p className="text-xs text-muted-foreground">当前回答始终绑定这份文档上下文</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full bg-background/70">当前文档</Badge>
              <Badge variant="outline" className="max-w-[220px] truncate rounded-full bg-background/70">{documentTitle}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 ? (
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={handleClear}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={onToggle}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 rounded-[28px] border border-primary/10 bg-primary/5 p-5 shadow-sm">
                <Bot className="mx-auto h-10 w-10 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">可以直接问整篇文档，也可以先在正文里选中片段后发送到这里。</p>
              <div className="mt-5 grid w-full gap-2 text-left">
                {[
                  "总结这一页的核心观点",
                  "解释当前段落里的关键术语",
                  "对比原文与译文在这个部分的差异",
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
                  className={cn("flex gap-3", message.role === "assistant" && "desktop-panel rounded-2xl border border-border/70 p-3")}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      message.role === "user" ? "bg-primary text-primary-foreground" : "border bg-background"
                    )}
                  >
                    {message.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {message.content}
                      {isStreaming && message === messages[messages.length - 1] && message.role === "assistant" && (
                        <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-text-bottom" />
                      )}
                    </div>
                    {message.role === "assistant" && message.sources && message.sources.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">引用片段</p>
                        {message.sources.map((source) => (
                          <div key={source.chunkId} className="text-xs text-muted-foreground">
                            [{source.documentTitle}] 分块 {source.chunkIndex + 1} · {(source.score * 100).toFixed(1)}%
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

        <div className="border-t p-3 shrink-0">
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Enter 发送，Shift + Enter 换行</span>
            <span>{isStreaming ? "正在基于当前文档检索与回答" : "回答会自动引用文档片段"}</span>
          </div>
          <div className="desktop-panel flex items-end gap-0 rounded-2xl border border-border/70 bg-background/85 p-1 focus-within:ring-2 focus-within:ring-ring">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  handleSend()
                }
              }}
              rows={1}
              placeholder="问这份文档里的概念、结论、片段出处或当前阅读内容"
              className="min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm focus:outline-none"
            />
            {isStreaming ? (
              <Button
                variant="ghost"
                size="icon"
                className="m-1 h-9 w-9 shrink-0 rounded-lg text-destructive"
                onClick={handleStop}
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="m-1 h-9 w-9 shrink-0 rounded-lg"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <SendHorizonal className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
