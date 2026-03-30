import type { Provider, ProviderModel, ProviderModelType } from "../../packages/types"

function sortProviders(providers: Provider[]) {
  return [...providers].sort((a, b) => {
    const priorityDelta = (a.priority ?? 0) - (b.priority ?? 0)
    if (priorityDelta !== 0) return priorityDelta
    return a.created_at.localeCompare(b.created_at)
  })
}

function sortModels(models: ProviderModel[]) {
  return [...models].sort((a, b) => {
    const priorityDelta = (a.priority ?? 0) - (b.priority ?? 0)
    if (priorityDelta !== 0) return priorityDelta
    return a.created_at.localeCompare(b.created_at)
  })
}

export function getActiveModelsForType(provider: Provider, modelType: ProviderModelType) {
  return sortModels(
    (provider.models ?? []).filter(
      (model) => model.is_active && model.model_type === modelType
    )
  )
}

export function getPrimaryModelForType(provider: Provider, modelType: ProviderModelType) {
  return getActiveModelsForType(provider, modelType)[0] ?? null
}

export function hasActiveModelType(provider: Provider, modelType: ProviderModelType) {
  return getPrimaryModelForType(provider, modelType) != null
}

export function getActiveProvidersForType(providers: Provider[] | undefined, modelType: ProviderModelType) {
  return sortProviders((providers ?? []).filter((provider) => provider.is_active && hasActiveModelType(provider, modelType)))
}

export function getActiveProviderForType(providers: Provider[] | undefined, modelType: ProviderModelType) {
  return getActiveProvidersForType(providers, modelType)[0] ?? null
}

export function countActiveProvidersForType(providers: Provider[] | undefined, modelType: ProviderModelType) {
  return getActiveProvidersForType(providers, modelType).length
}

export function toOpenAiChannelConfig(provider: Provider, model: ProviderModel) {
  return {
    name: provider.name,
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
    model: model.model_name,
    maxRetries: provider.max_retries,
    dimensions: model.config?.dimensions,
    rerankTopN: model.config?.rerank_top_n,
  }
}
