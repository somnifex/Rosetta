import { useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { type ChannelConfig } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, GripVertical, Eye, ChevronDown, ChevronUp, RotateCcw, ArrowDownUp } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const emptyChannel = (): Omit<ChannelConfig, "id"> => ({
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  supportsVision: false,
  maxRetries: 3,
  isActive: true,
})

interface ChannelSectionProps {
  title: string
  description: string
  icon: React.ReactNode
  channels: ChannelConfig[]
  onChange: (channels: ChannelConfig[]) => void
  channelType: "chat" | "translate" | "embed" | "rerank"
}

export function ChannelSection({ title, description, icon, channels, onChange, channelType }: ChannelSectionProps) {
  const { t } = useTranslation("settings")
  const { t: tc } = useTranslation("common")
  const { toast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyChannel())
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleAdd = () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.model) {
      toast({
        title: t("channel.toast.required.title"),
        description: t("channel.toast.required.description"),
        variant: "destructive",
      })
      return
    }
    const newChannel: ChannelConfig = { ...form, id: genId() }
    onChange([...channels, newChannel])
    setForm(emptyChannel())
    setShowForm(false)
    toast({ title: t("channel.toast.added.title"), description: t("channel.toast.added.description", { name: newChannel.name }) })
  }

  const handleDelete = (id: string) => {
    const ch = channels.find((c) => c.id === id)
    onChange(channels.filter((c) => c.id !== id))
    toast({ title: t("channel.toast.deleted.title"), description: t("channel.toast.deleted.description", { name: ch?.name || "" }) })
  }

  const handleToggleVision = (id: string) => {
    onChange(channels.map((c) => (c.id === id ? { ...c, supportsVision: !c.supportsVision } : c)))
  }

  const handleToggleActive = (id: string) => {
    onChange(channels.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c)))
  }

  const handleRetryChange = (id: string, value: number) => {
    onChange(channels.map((c) => (c.id === id ? { ...c, maxRetries: value } : c)))
  }

  // Drag and drop
  const handleDragStart = (index: number) => {
    dragItem.current = index
  }

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return
    if (dragItem.current === dragOverItem.current) {
      dragItem.current = null
      dragOverItem.current = null
      setDragOverIndex(null)
      return
    }
    const items = [...channels]
    const [dragged] = items.splice(dragItem.current, 1)
    items.splice(dragOverItem.current, 0, dragged)
    onChange(items)
    dragItem.current = null
    dragOverItem.current = null
    setDragOverIndex(null)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const moveItem = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1
    if (target < 0 || target >= channels.length) return
    const items = [...channels]
    ;[items[index], items[target]] = [items[target], items[index]]
    onChange(items)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Button
            size="sm"
            variant={showForm ? "secondary" : "default"}
            onClick={() => {
              setShowForm(!showForm)
              setForm(emptyChannel())
            }}
          >
            {showForm ? (
              <>{t("channel.collapse")}</>
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                {t("channel.add")}
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Add Form */}
        {showForm && (
          <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("channel.form.name")}</Label>
                <Input
                  placeholder={t("channel.form.name_placeholder")}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("channel.form.base_url")}</Label>
                <Input
                  placeholder="https://api.openai.com/v1"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("channel.form.api_key")}</Label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("channel.form.model")}</Label>
                <Input
                  placeholder={t(`channel.form.model_placeholder_${channelType}`)}
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              {(channelType === "chat" || channelType === "translate") && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.supportsVision}
                    onCheckedChange={(checked) => setForm({ ...form, supportsVision: checked })}
                  />
                  <Label className="flex items-center gap-1 cursor-pointer">
                    <Eye className="h-4 w-4" />
                    {t("channel.form.vision")}
                  </Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Label>{t("channel.form.retries")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  className="w-20"
                  value={form.maxRetries}
                  onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>
                <Plus className="mr-1 h-4 w-4" />
                {t("channel.confirm_add")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                {tc("btn.cancel")}
              </Button>
            </div>
          </div>
        )}

        {/* Channel List */}
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("channel.empty")}
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2 px-1">
              <ArrowDownUp className="h-3 w-3" />
              {t("channel.priority_hint")}
            </div>
            {channels.map((ch, index) => (
              <div
                key={ch.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                className={`flex items-center gap-3 border rounded-lg px-3 py-2.5 transition-all cursor-grab active:cursor-grabbing ${
                  dragOverIndex === index ? "border-primary bg-primary/5 scale-[1.01]" : ""
                } ${!ch.isActive ? "opacity-50" : ""}`}
              >
                {/* Drag Handle + Priority */}
                <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                  <GripVertical className="h-4 w-4" />
                  <span className="text-xs font-mono w-4 text-center">{index + 1}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{ch.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      {ch.model}
                    </Badge>
                    {ch.supportsVision && (channelType === "chat" || channelType === "translate") && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 hover:bg-violet-100 shrink-0">
                        <Eye className="h-3 w-3 mr-0.5" />
                        Vision
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{ch.baseUrl}</p>
                </div>

                {/* Retry */}
                <div className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground" title={t("channel.form.retries")}>
                  <RotateCcw className="h-3 w-3" />
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    className="w-14 h-7 text-xs text-center"
                    value={ch.maxRetries}
                    onChange={(e) => handleRetryChange(ch.id, parseInt(e.target.value) || 0)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                {/* Vision Toggle */}
                {(channelType === "chat" || channelType === "translate") && (
                  <div className="shrink-0" title={ch.supportsVision ? t("channel.vision_enabled") : t("channel.vision_disabled")}>
                    <Switch
                      checked={ch.supportsVision}
                      onCheckedChange={() => handleToggleVision(ch.id)}
                    />
                  </div>
                )}

                {/* Active Toggle */}
                <div className="shrink-0" title={ch.isActive ? t("channel.enabled") : t("channel.disabled")}>
                  <Switch
                    checked={ch.isActive}
                    onCheckedChange={() => handleToggleActive(ch.id)}
                  />
                </div>

                {/* Move Buttons */}
                <div className="flex flex-col shrink-0">
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => moveItem(index, "up")}
                    title={t("channel.move_up")}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={index === channels.length - 1}
                    onClick={() => moveItem(index, "down")}
                    title={t("channel.move_down")}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Delete */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(ch.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
