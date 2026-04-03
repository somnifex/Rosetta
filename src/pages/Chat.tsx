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
  encodeImageAttachmentAsDataUrl,
  findDocumentConversation,
  genId,
  getDefaultChatBehaviorSettings,
  generateConversationTitle,
  isImageAttachment,
  loadChatBehaviorSettings,
  loadConversations,
  patchConversation,
  renderPromptTemplate,
  removeConversation,
  replaceConversation,
  saveConversations,
  streamRagChat,
  type ChatRequestMessage,
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
import { ChatMarkdown } from "@/components/chat/ChatMarkdown"
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer"
import { PdfViewer } from "@/components/viewer/PdfViewer"
import {
  Bot,
  Check,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SendHorizonal,
  Settings2,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useResizableRightPanel } from "@/hooks/useResizableRightPanel"
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

function normalizeCodeLanguage(language: string) {
  const value = language.trim().toLowerCase()
  if (!value) return "text"
  if (value === "js") return "javascript"
  if (value === "ts") return "typescript"
  if (value === "py") return "python"
  if (value === "yml") return "yaml"
  if (value === "sh") return "bash"
  return value
}

interface MindmapNode {
  text: string
  children: MindmapNode[]
}

function parseMindmap(code: string): MindmapNode[] {
  const lines = code
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("%%"))

  const normalized = lines[0]?.trim().toLowerCase() === "mindmap" ? lines.slice(1) : lines
  if (!normalized.length) return []

  const roots: MindmapNode[] = []
  const stack: Array<{ level: number; node: MindmapNode }> = []

  for (const line of normalized) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const level = Math.floor(indent / 2)
    const text = line
      .trim()
      .replace(/^[-*+]\s*/, "")
      .replace(/^::icon\([^)]*\)\s*/, "")
      .replace(/^\w+\((.*)\)$/, "$1")
      .trim()

    if (!text) continue

    const node: MindmapNode = { text, children: [] }

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ level, node })
  }

  return roots
}

function getCodeRenderKind(language: string, code: string) {
  const normalized = normalizeCodeLanguage(language)
  const trimmed = code.trim().toLowerCase()

  if (["html", "htm", "svg", "xml"].includes(normalized)) {
    return "html"
  }

  if (normalized === "mindmap" || normalized === "mermaid" || trimmed.startsWith("mindmap")) {
    return "mindmap"
  }

  return "none"
}

function MindmapTree({ nodes }: { nodes: MindmapNode[] }) {
  if (!nodes.length) {
    return <p className="text-xs text-muted-foreground">No mindmap nodes found.</p>
  }

  return (
    <ul className="space-y-2">
      {nodes.map((node, index) => (
        <li key={`${node.text}-${index}`} className="relative pl-4">
          <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-primary/50" />
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
            {node.text}
          </div>
          {node.children.length ? (
            <div className="mt-2 border-l border-dashed border-border/70 pl-3">
              <MindmapTree nodes={node.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export default function Chat() {
  const { t } = useTranslation("chat")
  const { toast } = useToast()
  const location = useLocation()

  const [conversations, setConversations] = useState<ChatConversation[]>(() =>
    loadConversations()
  )
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem("rosetta:chat-active-id") ?? null
    } catch {
      return null
    }
  })
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [useLocalRagForNextTurn, setUseLocalRagForNextTurn] = useState(false)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [previewCodeBlock, setPreviewCodeBlock] = useState<{
    code: string
    language: string
  } | null>(null)
  const [previewCodeView, setPreviewCodeView] = useState<"code" | "render">("code")
  const [historyQuery, setHistoryQuery] = useState("")
  const [titleGeneratingId, setTitleGeneratingId] = useState<string | null>(null)
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  const savePendingRef = useRef<ChatConversation[] | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flushPendingSave() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (savePendingRef.current) {
      saveConversations(savePendingRef.current)
      savePendingRef.current = null
    }
  }

  useEffect(() => {
    return () => flushPendingSave()
  }, [])

  const deferredHistoryQuery = useDeferredValue(historyQuery)
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ?? null

  const { data: previewContent } = useQuery({
    queryKey: ["parsedContent", previewDocId],
    queryFn: () => api.getParsedContent(previewDocId!),
    enabled: !!previewDocId,
  })

  const { data: previewDocument } = useQuery({
    queryKey: ["document", previewDocId],
    queryFn: () => api.getDocumentById(previewDocId!),
    enabled: !!previewDocId,
  })

  const { data: previewTranslatedContent } = useQuery({
    queryKey: ["translatedContent", previewDocId],
    queryFn: () => api.getTranslatedContent(previewDocId!),
    enabled: !!previewDocId,
  })

  const { data: previewOutputs = [] } = useQuery({
    queryKey: ["documentOutputs", previewDocId],
    queryFn: () => api.getDocumentOutputs(previewDocId!),
    enabled: !!previewDocId,
  })

  const { data: chatBehaviorSettings } = useQuery({
    queryKey: ["chatBehaviorSettings"],
    queryFn: loadChatBehaviorSettings,
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
    if (activeId && conversations.some((conversation) => conversation.id === activeId)) {
      return
    }
    setActiveId(conversations[0]?.id ?? null)
  }, [activeId, conversations])

  useEffect(() => {
    try {
      if (activeId) {
        sessionStorage.setItem("rosetta:chat-active-id", activeId)
      } else {
        sessionStorage.removeItem("rosetta:chat-active-id")
      }
    } catch {
      // ignore storage errors
    }
  }, [activeId])

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

  function persist(updater: (current: ChatConversation[]) => ChatConversation[]) {
    setConversations((current) => {
      const next = updater(current)
      saveConversations(next)
      return next
    })
  }

  function applyConversationUpdates(id: string, updates: Partial<ChatConversation>) {
    setConversations((current) => {
      const next = patchConversation(current, id, updates)
      saveConversations(next)
      return next
    })
  }

  function applyConversationUpdatesLive(
    id: string,
    updates: Partial<ChatConversation>
  ) {
    setConversations((current) => {
      const next = patchConversation(current, id, updates)
      savePendingRef.current = next
      if (!saveTimerRef.current) {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null
          if (savePendingRef.current) {
            saveConversations(savePendingRef.current)
            savePendingRef.current = null
          }
        }, 500)
      }
      return next
    })
  }

  function openConversation(id: string) {
    startTransition(() => {
      setActiveId(id)
      setAttachments([])
      setPreviewDocId(null)
      setPreviewCodeBlock(null)
      setPreviewCodeView("code")
      setEditingMessageId(null)
      setEditingText("")
      setInput("")
    })
  }

  function togglePreviewDocument(documentId: string) {
    setPreviewCodeBlock(null)
    setPreviewDocId((current) =>
      current === documentId
        ? null
        : documentId
    )
  }

  function openCodePreview(payload: { code: string; language: string }) {
    setPreviewDocId(null)
    const normalizedLanguage = normalizeCodeLanguage(payload.language)
    const renderKind = getCodeRenderKind(normalizedLanguage, payload.code)
    setPreviewCodeBlock({
      code: payload.code,
      language: normalizedLanguage,
    })
    setPreviewCodeView(renderKind === "none" ? "code" : "render")
  }

  function handleCreateConversation() {
    const conversation = createConversation(t("new_chat"), {
      title: t("new_chat"),
      titleSource: "fallback",
      scope: "general",
    })
    persist((current) => replaceConversation(current, conversation))
    openConversation(conversation.id)
  }

  function handleDeleteConversation(id: string) {
    persist((current) => removeConversation(current, id))
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

    const currentConv = conversationsRef.current.find((c) => c.id === conversation.id)
    if (currentConv?.titleSource === "manual") return

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

  async function runAssistantTurn(
    conversation: ChatConversation,
    updatedMessages: ChatMessage[],
    userMessage: ChatMessage,
    composerAttachments: ChatAttachment[],
    options?: { forceLocalRag?: boolean }
  ) {
    const alwaysIncludeFullDocument =
      conversation.alwaysIncludeFullDocument ??
      chatBehaviorSettings?.defaultAlwaysIncludeFullDocument ??
      false

    const defaultBehavior = getDefaultChatBehaviorSettings()
    const effectiveBehavior = {
      documentAppendPrompt:
        chatBehaviorSettings?.documentAppendPrompt ||
        defaultBehavior.documentAppendPrompt,
      longTextRagPrompt:
        chatBehaviorSettings?.longTextRagPrompt ||
        defaultBehavior.longTextRagPrompt,
      longTextThreshold: chatBehaviorSettings?.longTextThreshold ?? defaultBehavior.longTextThreshold,
    }

    const primaryDocumentAttachment =
      conversation.scope === "document"
        ? conversation.contextAttachments[0]
        : null

    let requestUserContent = userMessage.content

    const fetchDocumentFullContent = async (documentId: string) => {
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

    let shouldEnableRetrieval =
      (options?.forceLocalRag ?? useLocalRagForNextTurn) ||
      conversation.scope === "document" ||
      composerAttachments.length > 0 ||
      conversation.contextAttachments.length > 0

    if (conversation.scope === "document" && alwaysIncludeFullDocument && primaryDocumentAttachment) {
      const fullDocument = await fetchDocumentFullContent(primaryDocumentAttachment.documentId)
      if (fullDocument.length > effectiveBehavior.longTextThreshold) {
        shouldEnableRetrieval = true
        requestUserContent = renderPromptTemplate(effectiveBehavior.longTextRagPrompt, {
          user_input: userMessage.content,
        })
        toast({
          title: t("composer.long_text_rag_enabled"),
          description: t("composer.long_text_rag_enabled_desc"),
        })
      } else if (fullDocument.trim()) {
        requestUserContent = renderPromptTemplate(effectiveBehavior.documentAppendPrompt, {
          user_input: userMessage.content,
          document_content: fullDocument,
        })
      }
    }

    if (!shouldEnableRetrieval && userMessage.content.length > effectiveBehavior.longTextThreshold) {
      shouldEnableRetrieval = true
      requestUserContent = renderPromptTemplate(effectiveBehavior.longTextRagPrompt, {
        user_input: userMessage.content,
      })
      toast({
        title: t("composer.long_text_rag_enabled"),
        description: t("composer.long_text_rag_enabled_desc"),
      })
    }

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

      let requestMessages: ChatRequestMessage[] = updatedMessages.map((message) => ({
        role: message.role,
        content: message.content,
      }))

      const latestUserIndex = updatedMessages.findIndex((message) => message.id === userMessage.id)
      if (latestUserIndex >= 0) {
        requestMessages[latestUserIndex] = {
          role: "user",
          content: requestUserContent,
        }
      }

      if (activeChatModel?.supports_vision) {
        const imageDataUrls = (
          await Promise.all(
            requestAttachments
              .filter(isImageAttachment)
              .slice(0, 3)
              .map((attachment) => encodeImageAttachmentAsDataUrl(attachment))
          )
        ).filter((value): value is string => !!value)

        if (imageDataUrls.length > 0) {
          const lastUserIndex = [...requestMessages]
            .map((msg, index) => ({ msg, index }))
            .reverse()
            .find((entry) => entry.msg.role === "user")?.index

          if (lastUserIndex != null) {
            const textContent =
              typeof requestMessages[lastUserIndex].content === "string"
                ? requestMessages[lastUserIndex].content
                : ""
            requestMessages[lastUserIndex] = {
              role: "user",
              content: [
                { type: "text", text: textContent },
                ...imageDataUrls.map((url) => ({
                  type: "image_url" as const,
                  image_url: { url },
                })),
              ],
            }
          }
        }
      }

      for await (const event of streamRagChat(
        {
          messages: requestMessages,
          attachments: requestAttachments,
          enableRetrieval: shouldEnableRetrieval,
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
      flushPendingSave()
      setIsStreaming(false)
      setUseLocalRagForNextTurn(false)
      abortRef.current = null
    }
  }

  async function handleSend() {
    if (!input.trim() && attachments.length === 0) return
    if (isStreaming) return

    let conversation = activeConversation
    if (!conversation) {
      conversation = createConversation(t("new_chat"), {
        title: t("new_chat"),
        titleSource: "fallback",
        scope: "general",
      })
      persist((current) => replaceConversation(current, conversation!))
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
    setEditingMessageId(null)
    setEditingText("")

    await runAssistantTurn(conversation, updatedMessages, userMessage, composerAttachments)
  }

  async function handleRetryFromUserMessage(messageId: string, editedContent?: string) {
    if (!activeId || isStreaming) return

    const currentConversation = conversationsRef.current.find((c) => c.id === activeId)
    if (!currentConversation) return

    const targetIndex = currentConversation.messages.findIndex(
      (message) => message.id === messageId && message.role === "user"
    )
    if (targetIndex < 0) return

    const sourceMessage = currentConversation.messages[targetIndex]
    const baseMessages = currentConversation.messages.slice(0, targetIndex)
    const nextContent = (editedContent ?? sourceMessage.content).trim()
    const sourceAttachments = sourceMessage.attachments ?? []
    const composerAttachments =
      currentConversation.scope === "document" ? [] : dedupeAttachments(sourceAttachments)

    if (!nextContent && composerAttachments.length === 0) return

    const retryUserMessage: ChatMessage = {
      id: genId(),
      role: "user",
      content: nextContent || t("attachment_default_prompt"),
      timestamp: Date.now(),
      attachments: composerAttachments.length ? composerAttachments : undefined,
    }

    const updatedMessages = [...baseMessages, retryUserMessage]
    const userCountBeforeRetry = baseMessages.filter((message) => message.role === "user").length

    applyConversationUpdates(currentConversation.id, {
      messages: updatedMessages,
      title:
        userCountBeforeRetry === 0 && currentConversation.titleSource !== "manual"
          ? deriveConversationTitleCandidate(retryUserMessage.content, t("new_chat"))
          : currentConversation.title,
      titleSource:
        userCountBeforeRetry === 0 && currentConversation.titleSource !== "manual"
          ? "fallback"
          : currentConversation.titleSource,
    })

    setEditingMessageId(null)
    setEditingText("")
    setInput("")
    setAttachments([])

    await runAssistantTurn(
      currentConversation,
      updatedMessages,
      retryUserMessage,
      composerAttachments,
      { forceLocalRag: false }
    )
  }

  function startEditMessage(message: ChatMessage) {
    setEditingMessageId(message.id)
    setEditingText(message.content)
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
    if (!activeId) return
    applyConversationUpdates(activeId, updates)
  }

  const activeMessages = activeConversation?.messages ?? []
  const contextAttachments = activeConversation?.contextAttachments ?? []
  const canSend = Boolean(input.trim() || attachments.length > 0)
  const previewCodeRenderKind = previewCodeBlock
    ? getCodeRenderKind(previewCodeBlock.language, previewCodeBlock.code)
    : "none"
  const isPreviewOpen = Boolean(previewDocId || previewCodeBlock)
  const {
    panelStyle: previewPanelStyle,
    isResizing: isPreviewResizing,
    startResize: startPreviewResize,
  } = useResizableRightPanel({
    defaultWidth: 460,
    minWidth: 340,
    maxWidth: 860,
    storageKey: "rosetta:chat-preview-panel-width",
  })
  const mindmapNodes =
    previewCodeRenderKind === "mindmap" && previewCodeBlock
      ? parseMindmap(previewCodeBlock.code)
      : []
  const previewFilename = previewDocument?.filename?.toLowerCase() ?? ""
  const previewOriginalPdf =
    previewDocument &&
    previewFilename.endsWith(".pdf") &&
    !previewDocument.is_file_missing
      ? previewDocument.file_path
      : null
  const previewTranslatedPdf =
    previewOutputs.find(
      (output) => output.output_type === "translated_pdf" && !output.is_file_missing
    )?.file_path ?? null
  const previewRenderablePdf = previewOriginalPdf ?? previewTranslatedPdf
  const previewParsedMarkdown = previewContent?.markdown_content?.trim() || ""
  const previewMarkdownContent =
    previewParsedMarkdown ||
    previewTranslatedContent?.content?.trim() ||
    ""
  const previewContentFormat = previewFilename.endsWith(".txt") ? "plain" : "markdown"

  return (
    <>
      <div className="chat-claude-surface relative flex h-full min-h-0 overflow-hidden">
        <aside className="chat-claude-sidebar relative z-10 flex w-[84px] shrink-0 flex-col border-r border-border/70 sm:w-[290px]">
          <div className="border-b border-border/70 px-3 py-4 sm:px-4">
            <div className="flex items-center justify-between gap-3">
              <h1 className="hidden text-base font-semibold tracking-tight text-foreground/90 sm:block">{t("title")}</h1>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full"
                onClick={handleCreateConversation}
                title={t("new_chat")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="relative mt-3 hidden sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder={t("history.search_placeholder")}
                className="h-10 rounded-2xl border-border/60 bg-background/85 pl-10 shadow-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto px-2 py-2">
            {filteredConversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <MessageSquare className="mb-3 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">{t("history.empty_title")}</p>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  {deferredHistoryQuery.trim()
                    ? t("history.empty_search")
                    : t("no_conversations_desc")}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => openConversation(conversation.id)}
                    className={cn(
                      "group flex w-full items-center justify-center gap-2.5 rounded-xl px-2 py-2.5 text-left text-sm transition sm:justify-start sm:px-3",
                      activeId === conversation.id
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                        : "text-foreground/90 hover:bg-background/70"
                    )}
                    title={conversation.title}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        activeId === conversation.id
                          ? "bg-muted text-foreground"
                          : conversation.scope === "document"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {conversation.scope === "document" ? (
                        <FileText className="h-3.5 w-3.5" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate font-medium sm:block">
                      {conversation.title}
                    </span>
                    {titleGeneratingId === conversation.id ? (
                      <Loader2
                        className={cn(
                          "h-3.5 w-3.5 animate-spin",
                          activeId === conversation.id ? "text-foreground" : "text-muted-foreground"
                        )}
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDeleteConversation(conversation.id)
                      }}
                      className={cn(
                        "hidden rounded-md p-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 sm:block",
                        activeId === conversation.id
                          ? "hover:bg-muted"
                          : "hover:bg-destructive/10 hover:text-destructive"
                      )}
                      title={t("history.delete")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="relative z-10 flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border/70 bg-background/75 px-5 py-3 backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold tracking-tight">
                  {activeConversation?.title ?? t("new_chat")}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
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
                  size="icon"
                  className="h-8 w-8 rounded-full bg-background/80"
                  onClick={() => setPickerOpen(true)}
                  disabled={activeConversation?.scope === "document"}
                  title={t("attach_document")}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full bg-background/80"
                  onClick={() => setSettingsOpen(true)}
                  disabled={!activeConversation}
                  title={t("settings.title")}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {contextAttachments.length ? (
              <div className="mx-auto mt-3 flex w-full max-w-4xl flex-wrap gap-2">
                {contextAttachments.map((attachment) => (
                  <Badge
                    key={attachment.documentId}
                    variant="outline"
                    className="gap-2 rounded-full bg-background/90 px-3 py-1"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span className="max-w-[220px] truncate">{attachment.title}</span>
                  </Badge>
                ))}
              </div>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="flex-1 overflow-auto px-4">
                {activeMessages.length === 0 ? (
                  <div className="mx-auto flex h-full w-full max-w-4xl flex-col items-center justify-center py-10 text-center">
                    <div className="w-full rounded-3xl border border-border/70 bg-background/80 px-6 py-10 shadow-sm">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-foreground">
                        <Bot className="h-7 w-7" />
                      </div>
                      <h3 className="text-xl font-semibold tracking-tight">{t("empty.title")}</h3>
                      <p className="mx-auto mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                        {activeConversation?.scope === "document"
                          ? t("empty.document_desc")
                          : t("empty.general_desc")}
                      </p>
                      <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
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
                            className="rounded-xl border border-border/70 bg-background/85 px-4 py-3 text-sm transition hover:bg-muted"
                          >
                            <div className="flex items-start gap-2.5">
                              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              <span>{suggestion}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-5xl pb-10 pt-3">
                    {activeMessages.map((message, index) => (
                      <article
                        key={message.id}
                        className={cn(
                          "group chat-fade-in px-1 py-5 sm:px-4",
                          message.role === "user" ? "flex justify-end" : "flex justify-start"
                        )}
                        style={{ animationDelay: `${Math.min(index * 36, 260)}ms` }}
                      >
                        <div
                          className={cn(
                            "min-w-0",
                            message.role === "user"
                              ? "w-full max-w-[78%] sm:max-w-[70%]"
                              : "w-full max-w-3xl"
                          )}
                        >
                          <div
                            className={cn(
                              "mb-2 flex items-center gap-2 text-[11px] text-muted-foreground",
                              message.role === "user" ? "justify-end" : "justify-start"
                            )}
                          >
                            <p className="font-medium text-foreground/80">
                              {message.role === "user"
                                ? t("role.user")
                                : message.role === "system"
                                  ? t("role.system")
                                  : t("role.assistant")}
                            </p>
                            <span>{formatConversationTime(message.timestamp)}</span>
                          </div>

                          <div
                            className={cn(
                              "min-w-0",
                              message.role === "user" &&
                                "rounded-3xl border border-border/70 bg-muted/65 px-4 py-3",
                              message.role === "system" &&
                                "rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
                            )}
                          >
                            {message.role === "user" && editingMessageId === message.id ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editingText}
                                  onChange={(event) => setEditingText(event.target.value)}
                                  className="min-h-[88px] w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => {
                                      setEditingMessageId(null)
                                      setEditingText("")
                                    }}
                                  >
                                    <X className="mr-1 h-3.5 w-3.5" />
                                    {t("message.cancel")}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => void handleRetryFromUserMessage(message.id, editingText)}
                                    disabled={!editingText.trim() || isStreaming}
                                  >
                                    <Check className="mr-1 h-3.5 w-3.5" />
                                    {t("message.save_and_retry")}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <ChatMarkdown
                                content={
                                  message.content +
                                  (isStreaming &&
                                  index === activeMessages.length - 1 &&
                                  message.role === "assistant"
                                    ? " ▍"
                                    : "")
                                }
                                onCodeBlockOpen={openCodePreview}
                                openCodeLabel={t("preview.open_code_panel")}
                                className={cn(
                                  message.role === "assistant" &&
                                    "leading-8 [&_p]:my-0 [&_p+*]:mt-4"
                                )}
                              />
                            )}
                          </div>

                          <div
                            className={cn(
                              "mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100",
                              message.role === "user" ? "justify-end" : "justify-start"
                            )}
                          >
                            {message.role === "user" ? (
                              <>
                                <button
                                  type="button"
                                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                  title={t("message.edit_and_retry")}
                                  onClick={() => startEditMessage(message)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                  title={t("message.retry")}
                                  onClick={() => void handleRetryFromUserMessage(message.id)}
                                  disabled={isStreaming}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : null}
                            {message.role === "assistant" ? (
                              <button
                                type="button"
                                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                                title={t("message.retry")}
                                disabled={
                                  isStreaming ||
                                  !activeMessages
                                    .slice(0, index)
                                    .reverse()
                                    .find((item) => item.role === "user")
                                }
                                onClick={() => {
                                  const previousUser = activeMessages
                                    .slice(0, index)
                                    .reverse()
                                    .find((item) => item.role === "user")
                                  if (!previousUser) return
                                  void handleRetryFromUserMessage(previousUser.id)
                                }}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>

                          {message.attachments?.length ? (
                            <div
                              className={cn(
                                "mt-3 flex flex-wrap gap-2",
                                message.role === "user" ? "justify-end" : "justify-start"
                              )}
                            >
                              {message.attachments.map((attachment) => (
                                <button
                                  key={attachment.documentId}
                                  type="button"
                                  onClick={() => togglePreviewDocument(attachment.documentId)}
                                  className={cn(
                                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                                    previewDocId === attachment.documentId
                                      ? "border-primary/30 bg-primary/10 text-primary"
                                      : "border-border bg-background hover:bg-muted"
                                  )}
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  {attachment.title}
                                </button>
                              ))}
                            </div>
                          ) : null}

                          {message.sources?.length ? (
                            <div className="mt-3 space-y-2">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                {t("sources.label")}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {message.sources.map((source) => (
                                  <button
                                    key={source.chunkId}
                                    type="button"
                                    onClick={() => togglePreviewDocument(source.documentId)}
                                    className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
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
                      </article>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="border-t border-border/70 bg-background/80 px-4 py-3 backdrop-blur-sm">
                <div className="mx-auto w-full max-w-4xl">
                  {attachments.length ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {attachments.map((attachment) => (
                        <Badge
                          key={attachment.documentId}
                          variant="outline"
                          className="gap-2 rounded-full bg-background px-3 py-1.5"
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

                  <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                    <span>{t("composer.shortcut")}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant={useLocalRagForNextTurn ? "default" : "outline"}
                        size="sm"
                        className="h-7 rounded-full px-3 text-[11px]"
                        onClick={() => setUseLocalRagForNextTurn((current) => !current)}
                      >
                        {t("composer.local_rag_toggle")}
                      </Button>
                      <span>
                        {activeConversation?.retrievalTopK
                          ? t("composer.retrieval_top_k", {
                              count: activeConversation.retrievalTopK,
                            })
                          : t("composer.retrieval_default")}
                      </span>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "chat-claude-composer flex items-end gap-1 rounded-[1.6rem] border p-1.5 transition-all duration-200",
                      isComposerFocused
                        ? "border-primary/35 shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]"
                        : "border-border/75"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      disabled={activeConversation?.scope === "document"}
                      className="m-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      title={t("attach_document")}
                    >
                      <Paperclip className="h-4.5 w-4.5" />
                    </button>

                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={handleKeyDown}
                      onFocus={() => setIsComposerFocused(true)}
                      onBlur={() => setIsComposerFocused(false)}
                      rows={1}
                      placeholder={
                        activeConversation?.scope === "document"
                          ? t("composer.document_placeholder")
                          : t("input_placeholder")
                      }
                      className="min-h-[48px] flex-1 resize-none bg-transparent px-2.5 py-2.5 text-sm leading-7 placeholder:text-muted-foreground focus:outline-none"
                    />

                    {isStreaming ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="m-1 h-10 w-10 shrink-0 rounded-xl text-destructive transition duration-200 hover:bg-destructive/10"
                        onClick={handleStop}
                      >
                        <Square className="h-4 w-4 fill-current" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        className={cn(
                          "m-1 h-10 w-10 shrink-0 rounded-xl transition duration-200",
                          canSend && "chat-soft-pulse"
                        )}
                        onClick={() => void handleSend()}
                        disabled={!canSend}
                      >
                        <SendHorizonal className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </main>

            {isPreviewOpen ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex justify-end">
                <button
                  type="button"
                  className="pointer-events-auto absolute inset-0 bg-black/20"
                  onClick={() => {
                    setPreviewDocId(null)
                    setPreviewCodeBlock(null)
                    setPreviewCodeView("code")
                  }}
                />
                <aside
                  className="chat-slide-in glass-surface pointer-events-auto relative flex h-full w-full max-w-[92vw] flex-col border-l border-border/60 shadow-2xl"
                  style={previewPanelStyle}
                >
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize preview panel"
                    className={cn(
                      "absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize",
                      isPreviewResizing ? "bg-primary/15" : "hover:bg-primary/10"
                    )}
                    onPointerDown={startPreviewResize}
                  />
                  <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {previewCodeBlock ? t("preview.code_title") : t("preview.title")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {previewCodeBlock
                        ? t("preview.code_description", {
                            language: previewCodeBlock.language,
                          })
                        : t("preview.description")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {previewCodeBlock && previewCodeRenderKind !== "none" ? (
                      <div className="inline-flex items-center rounded-lg border border-border/70 bg-background p-0.5">
                        <button
                          type="button"
                          className={cn(
                            "rounded-md px-2 py-1 text-xs transition",
                            previewCodeView === "render"
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground"
                          )}
                          onClick={() => setPreviewCodeView("render")}
                        >
                          {t("preview.render_tab")}
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "rounded-md px-2 py-1 text-xs transition",
                            previewCodeView === "code"
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground"
                          )}
                          onClick={() => setPreviewCodeView("code")}
                        >
                          {t("preview.code_tab")}
                        </button>
                      </div>
                    ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-2xl"
                        onClick={() => {
                          setPreviewDocId(null)
                          setPreviewCodeBlock(null)
                          setPreviewCodeView("code")
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                  </div>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    {previewCodeBlock ? (
                      previewCodeView === "render" && previewCodeRenderKind === "html" ? (
                        <div className="h-full overflow-hidden rounded-2xl border border-border/80 bg-background">
                          <iframe
                            title="html-preview"
                            srcDoc={previewCodeBlock.code}
                            sandbox="allow-scripts"
                            className="h-full w-full"
                          />
                        </div>
                      ) : previewCodeView === "render" && previewCodeRenderKind === "mindmap" ? (
                        <div className="rounded-2xl border border-border/80 bg-muted/25 p-3">
                          <MindmapTree nodes={mindmapNodes} />
                        </div>
                      ) : (
                        <div className="overflow-hidden rounded-2xl border border-border/80 bg-background">
                          <div className="border-b border-border/70 bg-muted/45 px-3 py-2">
                            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              {previewCodeBlock.language}
                            </span>
                          </div>
                          <pre className="max-h-full overflow-auto p-3 text-xs leading-6 text-foreground">
                            <code>{previewCodeBlock.code}</code>
                          </pre>
                        </div>
                      )
                    ) : previewRenderablePdf ? (
                      <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-background">
                        <PdfViewer
                          fileUrl={previewRenderablePdf}
                          fileName={previewDocument?.filename}
                          showZoomControls={false}
                          className="h-full"
                        />
                      </div>
                    ) : previewParsedMarkdown ? (
                      <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-background">
                        <MarkdownViewer
                          content={previewParsedMarkdown}
                          contentFormat={previewContentFormat}
                          assetBaseDir={previewContent?.asset_base_dir}
                          textScale={0.92}
                          className="h-full px-2 py-3"
                          contentClassName="prose-headings:tracking-tight prose-p:text-[0.98em]"
                        />
                      </div>
                    ) : previewMarkdownContent ? (
                      <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-background">
                        <MarkdownViewer
                          content={previewMarkdownContent}
                          contentFormat={previewContentFormat}
                          assetBaseDir={previewContent?.asset_base_dir}
                          textScale={0.92}
                          className="h-full px-2 py-3"
                          contentClassName="prose-headings:tracking-tight prose-p:text-[0.98em]"
                        />
                      </div>
                    ) : (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {t("preview.no_content")}
                      </p>
                    )}
                  </div>
                </aside>
              </div>
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
