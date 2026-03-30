import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { channelStore, type ChannelConfig } from "@/lib/api"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { MessageSquare, Languages, Layers, ListRestart } from "lucide-react"
import { ChannelSection } from "./ChannelSection"

export default function ProvidersTab() {
  const { t } = useTranslation("settings")

  const [chatChannels, setChatChannels] = useState<ChannelConfig[]>(() => channelStore.getChatChannels())
  const [translateChannels, setTranslateChannels] = useState<ChannelConfig[]>(() => channelStore.getTranslateChannels())
  const [embedChannels, setEmbedChannels] = useState<ChannelConfig[]>(() => channelStore.getEmbedChannels())
  const [rerankChannels, setRerankChannels] = useState<ChannelConfig[]>(() => channelStore.getRerankChannels())
  const [failoverEnabled, setFailoverEnabled] = useState(() => channelStore.getFailoverEnabled())

  const updateChatChannels = useCallback((channels: ChannelConfig[]) => {
    setChatChannels(channels)
    channelStore.saveChatChannels(channels)
  }, [])

  const updateTranslateChannels = useCallback((channels: ChannelConfig[]) => {
    setTranslateChannels(channels)
    channelStore.saveTranslateChannels(channels)
  }, [])

  const updateEmbedChannels = useCallback((channels: ChannelConfig[]) => {
    setEmbedChannels(channels)
    channelStore.saveEmbedChannels(channels)
  }, [])

  const updateRerankChannels = useCallback((channels: ChannelConfig[]) => {
    setRerankChannels(channels)
    channelStore.saveRerankChannels(channels)
  }, [])

  const toggleFailover = useCallback((enabled: boolean) => {
    setFailoverEnabled(enabled)
    channelStore.setFailoverEnabled(enabled)
  }, [])

  return (
    <div className="space-y-4">
      {/* Global Failover Settings */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="font-medium text-sm">{t("providers.failover.label")}</p>
            <p className="text-xs text-muted-foreground">
              {t("providers.failover.description")}
            </p>
          </div>
          <Switch checked={failoverEnabled} onCheckedChange={toggleFailover} />
        </CardContent>
      </Card>

      {/* Chat Channels */}
      <ChannelSection
        title={t("providers.chat.title")}
        description={t("providers.chat.description")}
        icon={<MessageSquare className="h-5 w-5 text-blue-500" />}
        channels={chatChannels}
        onChange={updateChatChannels}
        channelType="chat"
      />

      {/* Translate Channels */}
      <ChannelSection
        title={t("providers.translate.title")}
        description={t("providers.translate.description")}
        icon={<Languages className="h-5 w-5 text-amber-500" />}
        channels={translateChannels}
        onChange={updateTranslateChannels}
        channelType="translate"
      />

      {/* Embedding Channels */}
      <ChannelSection
        title={t("providers.embed.title")}
        description={t("providers.embed.description")}
        icon={<Layers className="h-5 w-5 text-emerald-500" />}
        channels={embedChannels}
        onChange={updateEmbedChannels}
        channelType="embed"
      />

      {/* Rerank Channels */}
      <ChannelSection
        title={t("providers.rerank.title")}
        description={t("providers.rerank.description")}
        icon={<ListRestart className="h-5 w-5 text-purple-500" />}
        channels={rerankChannels}
        onChange={updateRerankChannels}
        channelType="rerank"
      />
    </div>
  )
}
