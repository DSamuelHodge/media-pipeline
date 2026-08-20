import type { AssetRow } from "../catalog";

export const TOKEN = "test-upload-token";
export const ORIGIN = "https://media.hodgeluke.com";

type R2Entry = {
  buf: ArrayBuffer;
  httpMetadata?: { contentType?: string };
};

export function concatChunks(chunks: Uint8Array[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export async function readBody(value: unknown): Promise<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value === "string") return new TextEncoder().encode(value).buffer;
  if (value && typeof (value as ReadableStream).getReader === "function") {
    const reader = (value as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (chunk) chunks.push(chunk);
    }
    return concatChunks(chunks);
  }
  return new ArrayBuffer(0);
}

export function fakeR2(initial: Record<string, string | ArrayBuffer> = {}) {
  const store = new Map<string, R2Entry>();
  for (const [key, value] of Object.entries(initial)) {
    const buf = typeof value === "string" ? new TextEncoder().encode(value).buffer : value;
    store.set(key, { buf, httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  }

  return {
    store,
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { buf: await readBody(value), httpMetadata: opts?.httpMetadata });
    },
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: entry.buf,
        httpMetadata: entry.httpMetadata,
        arrayBuffer: async () => entry.buf,
      };
    },
  };
}

export function fakeD1(initial: AssetRow[] = []) {
  const rows = new Map<string, AssetRow>(initial.map((row) => [row.id, { ...row }]));
  let hideNextSelect = false;
  let emptyAll = false;

  function now() {
    return new Date().toISOString();
  }

  return {
    rows,
    hideNextSelect() {
      hideNextSelect = true;
    },
    emptyAll() {
      emptyAll = true;
    },
    prepare(sql: string) {
      const stmt = {
        _binds: [] as unknown[],
        bind(...args: unknown[]) {
          stmt._binds = args;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (hideNextSelect) {
            hideNextSelect = false;
            return null;
          }
          const id = stmt._binds[0] as string;
          return (rows.get(id) as T | undefined) ?? null;
        },
        async all<T>(): Promise<{ results?: T[] }> {
          if (emptyAll) {
            emptyAll = false;
            return {};
          }
          let list = [...rows.values()];
          const kindFilter = sql.includes("WHERE kind");
          if (kindFilter) {
            list = list.filter((row) => row.kind === stmt._binds[0]);
          }
          list.sort((a, b) => b.created_at.localeCompare(a.created_at));
          const limit = (kindFilter ? stmt._binds[1] : stmt._binds[0]) as number;
          const offset = (kindFilter ? stmt._binds[2] : stmt._binds[1]) as number;
          return { results: list.slice(offset, offset + limit) as T[] };
        },
        async run() {
          if (sql.includes("INSERT")) {
            const [id, kind, title, filename, content_type, size, original_key, status, workflow_id] = stmt._binds;
            const ts = now();
            rows.set(id as string, {
              id: id as string,
              kind: kind as AssetRow["kind"],
              title: (title as string | null) ?? null,
              filename: filename as string,
              content_type: content_type as string,
              size: (size as number | null) ?? null,
              original_key: original_key as string,
              derived_markdown_key: null,
              derived_transcript_key: null,
              derived_vtt_key: null,
              status: status as AssetRow["status"],
              error: null,
              workflow_id: (workflow_id as string | null) ?? null,
              created_at: ts,
              updated_at: ts,
            });
            return { success: true };
          }
          if (sql.includes("UPDATE")) {
            const [status, error, markdown, transcript, vtt, workflowId, id] = stmt._binds;
            const row = rows.get(id as string);
            if (row) {
              row.status = status as AssetRow["status"];
              row.error = (error as string | null) ?? null;
              if (markdown != null) row.derived_markdown_key = markdown as string;
              if (transcript != null) row.derived_transcript_key = transcript as string;
              if (vtt != null) row.derived_vtt_key = vtt as string;
              if (workflowId != null) row.workflow_id = workflowId as string;
              row.updated_at = now();
            }
            return { success: true };
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

export function sampleRow(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: "asset-1",
    kind: "image",
    title: "Hero",
    filename: "hero.jpg",
    content_type: "image/jpeg",
    size: 12,
    original_key: "originals/images/asset-1.jpg",
    derived_markdown_key: null,
    derived_transcript_key: null,
    derived_vtt_key: null,
    status: "ready",
    error: null,
    workflow_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type WorkflowInstance = { id: string; status: () => Promise<unknown> };

export function makeEnv(opts: {
  db?: ReturnType<typeof fakeD1>;
  r2?: ReturnType<typeof fakeR2>;
  token?: string | undefined;
  firecrawl?: string;
  siteStatus?: number;
  siteBody?: string;
  workflowCreate?: (input: { id: string; params: unknown }) => Promise<WorkflowInstance>;
  workflowGet?: (id: string) => Promise<WorkflowInstance>;
  ai?: Ai;
} = {}): Env {
  const db = opts.db ?? fakeD1();
  const r2 = opts.r2 ?? fakeR2();
  const token = opts.token === undefined ? TOKEN : opts.token;

  return {
    ASSETS: r2 as unknown as R2Bucket,
    SITE: {
      fetch: async () => new Response(opts.siteBody ?? "site", { status: opts.siteStatus ?? 404 }),
    } as Fetcher,
    DB: db as unknown as D1Database,
    AI: (opts.ai ?? {
      run: async () => ({ text: "hello world", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n" }),
      toMarkdown: async () => ({ format: "markdown", data: "# pdf" }),
    }) as unknown as Ai,
    PROCESS_ASSET: {
      create: opts.workflowCreate ?? (async (input: { id: string }) => ({
        id: input.id,
        status: async () => ({ status: "queued" }),
      })),
      get:
        opts.workflowGet ??
        (async (id: string) => ({
          id,
          status: async () => ({ status: "running" }),
        })),
    } as unknown as Env["PROCESS_ASSET"],
    MEDIA_PUBLIC_ORIGIN: ORIGIN,
    UPLOAD_TOKEN: token ?? "",
    FIRECRAWL_API_KEY: opts.firecrawl,
    SECRET_UPLOAD_TOKEN: { get: async () => token ?? "" },
    SECRET_FIRECRAWL_API_KEY: { get: async () => opts.firecrawl ?? "" },
  };
}

export function jsonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ingest.hodgeluke.com${path}`, init);
}

export async function uploadRequest(file: File, extra: Record<string, string> = {}, token = TOKEN): Promise<Request> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return new Request("https://ingest.hodgeluke.com/upload", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

export const passThroughStep = {
  async do(_name: string, optsOrFn: unknown, maybeFn?: unknown) {
    const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
    return (fn as () => Promise<unknown>)();
  },
};
