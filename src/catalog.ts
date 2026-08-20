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

export type StatusExtra = {
  error?: string | null;
  derivedMarkdownKey?: string;
  derivedTranscriptKey?: string;
  derivedVttKey?: string;
  workflowId?: string;
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

export type ListFilter = {
  kind?: AssetKind;
  q?: string;
};

export type KindCounts = {
  all: number;
  image: number;
  video: number;
  audio: number;
  pdf: number;
};

const LIKE_ESCAPE = "\\";

export function searchLike(q?: string | null): string | null {
  const trimmed = q?.trim();
  if (!trimmed) return null;
  const clipped = trimmed.slice(0, 80);
  const escaped = clipped.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return `%${escaped}%`;
}

function prepared(db: D1Database, sql: string, binds: unknown[]) {
  const stmt = db.prepare(sql);
  return binds.length ? stmt.bind(...binds) : stmt;
}

function whereClause(filter: ListFilter): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filter.kind) {
    clauses.push("kind = ?");
    binds.push(filter.kind);
  }
  const like = searchLike(filter.q);
  if (like) {
    clauses.push(
      `(title LIKE ? COLLATE NOCASE ESCAPE '${LIKE_ESCAPE}' OR filename LIKE ? COLLATE NOCASE ESCAPE '${LIKE_ESCAPE}')`,
    );
    binds.push(like, like);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds,
  };
}

export async function listAssets(
  db: D1Database,
  opts: ListFilter & { limit: number; offset: number },
): Promise<AssetRow[]> {
  const { sql: where, binds } = whereClause(opts);
  const result = await prepared(
    db,
    `SELECT * FROM assets ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...binds, opts.limit, opts.offset],
  ).all<AssetRow>();
  return result.results ?? [];
}

export async function countAssets(db: D1Database, filter: ListFilter = {}): Promise<number> {
  const { sql: where, binds } = whereClause(filter);
  const row = await prepared(db, `SELECT COUNT(*) AS n FROM assets ${where}`, binds).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function kindCounts(db: D1Database, q?: string): Promise<KindCounts> {
  const { sql: where, binds } = whereClause({ q });
  const result = await prepared(db, `SELECT kind, COUNT(*) AS n FROM assets ${where} GROUP BY kind`, binds).all<{
    kind: string;
    n: number;
  }>();
  const counts: KindCounts = { all: 0, image: 0, video: 0, audio: 0, pdf: 0 };
  for (const row of result.results ?? []) {
    if (row.kind === "image" || row.kind === "video" || row.kind === "audio" || row.kind === "pdf") {
      counts[row.kind] = Number(row.n);
      counts.all += Number(row.n);
    }
  }
  return counts;
}

export async function setStatus(
  db: D1Database,
  id: string,
  status: AssetStatus,
  extra: StatusExtra = {},
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
