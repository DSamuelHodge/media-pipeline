CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'pdf')),
  title TEXT,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER,
  original_key TEXT NOT NULL,
  derived_markdown_key TEXT,
  derived_transcript_key TEXT,
  derived_vtt_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  error TEXT,
  workflow_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_assets_kind_created ON assets (kind, created_at DESC);
CREATE INDEX idx_assets_status ON assets (status);
