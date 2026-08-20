import type { AssetKind } from "./kinds";
import { publicUrls } from "./urls";

export type AssetStatus = "uploaded" | "processing" | "ready" | "failed";

export type AssetRow = {
  id: string;
  kind: AssetKind;
  title: string | null;
  filename: string;
  content_type: string;
  size: number | null;
  original_key: string;
  derived_markdown_key: string | null;
  derived_transcript_key: string | null;
  derived_vtt_key: string | null;
  status: AssetStatus;
  error: string | null;
  workflow_id: string | null;
  created_at: string;
  updated_at: string;
};

export function withUrls(row: AssetRow, origin: string) {
  return {
    ...row,
    urls: publicUrls({
      origin,
      kind: row.kind,
      originalKey: row.original_key,
      derivedMarkdownKey: row.derived_markdown_key,
      derivedTranscriptKey: row.derived_transcript_key,
      derivedVttKey: row.derived_vtt_key,
    }),
  };
}

export async function insertAsset(
  db: D1Database,
  row: Pick<
    AssetRow,
    "id" | "kind" | "title" | "filename" | "content_type" | "size" | "original_key" | "status" | "workflow_id"
  >,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO assets (
        id, kind, title, filename, content_type, size, original_key, status, workflow_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.kind,
      row.title,
      row.filename,
      row.content_type,
      row.size,
      row.original_key,
      row.status,
      row.workflow_id,
    )
    .run();
}

export async function getAsset(db: D1Database, id: string): Promise<AssetRow | null> {
  return db.prepare("SELECT * FROM assets WHERE id = ?").bind(id).first<AssetRow>();
}

export async function listAssets(
  db: D1Database,
  opts: { kind?: AssetKind; limit: number; offset: number },
): Promise<AssetRow[]> {
  if (opts.kind) {
    const result = await db
      .prepare("SELECT * FROM assets WHERE kind = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .bind(opts.kind, opts.limit, opts.offset)
      .all<AssetRow>();
    return result.results ?? [];
  }
  const result = await db
    .prepare("SELECT * FROM assets ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(opts.limit, opts.offset)
    .all<AssetRow>();
  return result.results ?? [];
}

export async function setStatus(
  db: D1Database,
  id: string,
  status: AssetStatus,
  extra: {
    error?: string | null;
    derivedMarkdownKey?: string | null;
    derivedTranscriptKey?: string | null;
    derivedVttKey?: string | null;
    workflowId?: string | null;
  } = {},
): Promise<void> {
  await db
    .prepare(
      `UPDATE assets SET
        status = ?,
        error = ?,
        derived_markdown_key = COALESCE(?, derived_markdown_key),
        derived_transcript_key = COALESCE(?, derived_transcript_key),
        derived_vtt_key = COALESCE(?, derived_vtt_key),
        workflow_id = COALESCE(?, workflow_id),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    )
    .bind(
      status,
      extra.error ?? null,
      extra.derivedMarkdownKey ?? null,
      extra.derivedTranscriptKey ?? null,
      extra.derivedVttKey ?? null,
      extra.workflowId ?? null,
      id,
    )
    .run();
}
