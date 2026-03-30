CREATE TABLE IF NOT EXISTS provider_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    model_type TEXT NOT NULL CHECK(model_type IN ('chat', 'translate', 'embed', 'rerank')),
    model_name TEXT NOT NULL,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    config TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_models_type_active_priority ON provider_models(model_type, is_active, priority);

INSERT INTO provider_models (
    id,
    provider_id,
    name,
    model_type,
    model_name,
    supports_vision,
    is_active,
    priority,
    config,
    created_at,
    updated_at
)
SELECT
    lower(hex(randomblob(16))),
    p.id,
    COALESCE(NULLIF(trim(p.chat_model), ''), 'Chat Model'),
    'chat',
    p.chat_model,
    0,
    p.is_active,
    0,
    NULL,
    p.created_at,
    p.updated_at
FROM providers p
WHERE p.chat_model IS NOT NULL
  AND trim(p.chat_model) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM provider_models pm
      WHERE pm.provider_id = p.id
        AND pm.model_type = 'chat'
        AND pm.model_name = p.chat_model
  );

INSERT INTO provider_models (
    id,
    provider_id,
    name,
    model_type,
    model_name,
    supports_vision,
    is_active,
    priority,
    config,
    created_at,
    updated_at
)
SELECT
    lower(hex(randomblob(16))),
    p.id,
    COALESCE(NULLIF(trim(p.chat_model), ''), 'Translate Model'),
    'translate',
    p.chat_model,
    0,
    p.is_active,
    0,
    NULL,
    p.created_at,
    p.updated_at
FROM providers p
WHERE p.chat_model IS NOT NULL
  AND trim(p.chat_model) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM provider_models pm
      WHERE pm.provider_id = p.id
        AND pm.model_type = 'translate'
        AND pm.model_name = p.chat_model
  );

INSERT INTO provider_models (
    id,
    provider_id,
    name,
    model_type,
    model_name,
    supports_vision,
    is_active,
    priority,
    config,
    created_at,
    updated_at
)
SELECT
    lower(hex(randomblob(16))),
    p.id,
    COALESCE(NULLIF(trim(p.embedding_model), ''), 'Embedding Model'),
    'embed',
    p.embedding_model,
    0,
    p.is_active,
    0,
    NULL,
    p.created_at,
    p.updated_at
FROM providers p
WHERE p.embedding_model IS NOT NULL
  AND trim(p.embedding_model) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM provider_models pm
      WHERE pm.provider_id = p.id
        AND pm.model_type = 'embed'
        AND pm.model_name = p.embedding_model
  );

INSERT INTO provider_models (
    id,
    provider_id,
    name,
    model_type,
    model_name,
    supports_vision,
    is_active,
    priority,
    config,
    created_at,
    updated_at
)
SELECT
    lower(hex(randomblob(16))),
    p.id,
    COALESCE(NULLIF(trim(p.rerank_model), ''), 'Rerank Model'),
    'rerank',
    p.rerank_model,
    0,
    p.is_active,
    0,
    NULL,
    p.created_at,
    p.updated_at
FROM providers p
WHERE p.rerank_model IS NOT NULL
  AND trim(p.rerank_model) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM provider_models pm
      WHERE pm.provider_id = p.id
        AND pm.model_type = 'rerank'
        AND pm.model_name = p.rerank_model
  );
