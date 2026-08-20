import { requireUploadToken } from "./auth";
import { getAsset, insertAsset, listAssets, setStatus, withUrls } from "./catalog";
import { corsHeaders, json, withCors } from "./cors";
import { isKind, kindNeedsWorkflow, originalKey, resolveKind, type AssetKind } from "./kinds";
import { readSecret } from "./secrets";
import { ProcessAssetWorkflow } from "./workflow";

export { ProcessAssetWorkflow };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json(request, { ok: true });
      }

      if (request.method === "GET" && url.pathname === "/assets") {
        return list(request, env);
      }

      const assetMatch = url.pathname.match(/^\/assets\/([^/]+)(?:\/(status|markdown|transcript|vtt))?$/);
      if (assetMatch) {
        const id = decodeURIComponent(assetMatch[1] ?? "");
        const sub = assetMatch[2];
        if (request.method === "GET" && !sub) return show(request, env, id);
        if (request.method === "GET" && sub === "status") return status(request, env, id);
        if (request.method === "GET" && sub === "markdown") {
          return derived(request, env, id, "derived_markdown_key");
        }
        if (request.method === "GET" && sub === "transcript") {
          return derived(request, env, id, "derived_transcript_key");
        }
        if (request.method === "GET" && sub === "vtt") return derived(request, env, id, "derived_vtt_key");
      }

      if (request.method === "POST" && url.pathname === "/upload") {
        const token = await readSecret(env.SECRET_UPLOAD_TOKEN, env.UPLOAD_TOKEN);
        const denied = await requireUploadToken(request, token);
        if (denied) return withCors(request, denied);
        return upload(request, env);
      }

      if (env.SITE) {
        const page = await env.SITE.fetch(request);
        if (page.status !== 404) return page;
      }

      const objectKey = url.pathname.replace(/^\//, "");
      if (objectKey && !objectKey.endsWith("/")) {
        const object = await env.ASSETS.get(objectKey);
        if (object?.body) {
          return new Response(object.body, {
            headers: {
              "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
              "cache-control": "public, max-age=14400",
            },
          });
        }
      }

      return json(request, { error: "not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal error";
      console.error(JSON.stringify({ error: message }));
      return json(request, { error: message }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function list(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const kind = isKind(kindParam) ? kindParam : undefined;
  if (kindParam && !kind) {
    return json(request, { error: "kind must be image, video, audio, or pdf" }, { status: 400 });
  }
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
  const rows = await listAssets(env.DB, { kind, limit, offset });
  return json(request, {
    assets: rows.map((row) => withUrls(row, env.MEDIA_PUBLIC_ORIGIN)),
  });
}

async function show(request: Request, env: Env, id: string): Promise<Response> {
  const row = await getAsset(env.DB, id);
  if (!row) return json(request, { error: "not found" }, { status: 404 });
  return json(request, withUrls(row, env.MEDIA_PUBLIC_ORIGIN));
}

async function status(request: Request, env: Env, id: string): Promise<Response> {
  const row = await getAsset(env.DB, id);
  if (!row) return json(request, { error: "not found" }, { status: 404 });

  let workflow = null;
  if (row.workflow_id) {
    try {
      const instance = await env.PROCESS_ASSET.get(row.workflow_id);
      workflow = await instance.status();
    } catch {
      workflow = { error: "workflow instance not found" };
    }
  }

  return json(request, {
    id: row.id,
    status: row.status,
    error: row.error,
    workflow,
  });
}

async function derived(
  request: Request,
  env: Env,
  id: string,
  field: "derived_markdown_key" | "derived_transcript_key" | "derived_vtt_key",
): Promise<Response> {
  const row = await getAsset(env.DB, id);
  if (!row) return json(request, { error: "not found" }, { status: 404 });
  const key = row[field];
  if (!key) return json(request, { error: "derivative not ready" }, { status: 409 });
  const object = await env.ASSETS.get(key);
  if (!object) return json(request, { error: "derivative missing" }, { status: 404 });
  return withCors(
    request,
    new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "text/plain; charset=utf-8",
      },
    }),
  );
}

async function upload(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json(request, { error: "expected multipart/form-data" }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json(request, { error: "file field is required" }, { status: 400 });
  }

  const filename = file.name || "upload";
  const mime = file.type || "application/octet-stream";
  const requestedKind = typeof form.get("kind") === "string" ? (form.get("kind") as string) : null;
  const kind: AssetKind | null = resolveKind(mime, filename, requestedKind);
  if (!kind) {
    return json(request, { error: "could not determine kind; pass kind=image|video|audio|pdf" }, { status: 400 });
  }

  const title = typeof form.get("title") === "string" && form.get("title") ? String(form.get("title")) : filename;
  const id = crypto.randomUUID();
  const key = originalKey(kind, id, filename);

  await env.ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: mime },
    customMetadata: { assetId: id, kind, filename },
  });

  if (!kindNeedsWorkflow(kind)) {
    await insertAsset(env.DB, {
      id,
      kind,
      title,
      filename,
      content_type: mime,
      size: file.size,
      original_key: key,
      status: "ready",
      workflow_id: null,
    });
    const row = await getAsset(env.DB, id);
    return json(
      request,
      row ? withUrls(row, env.MEDIA_PUBLIC_ORIGIN) : { id, kind, original_key: key, status: "ready" },
      { status: 201 },
    );
  }

  const workflowId = `process-${id}`;
  await insertAsset(env.DB, {
    id,
    kind,
    title,
    filename,
    content_type: mime,
    size: file.size,
    original_key: key,
    status: "uploaded",
    workflow_id: workflowId,
  });

  try {
    const instance = await env.PROCESS_ASSET.create({
      id: workflowId,
      params: { id, kind },
    });
    const row = await getAsset(env.DB, id);
    return json(
      request,
      {
        ...(row ? withUrls(row, env.MEDIA_PUBLIC_ORIGIN) : { id, kind, original_key: key }),
        workflow: { id: instance.id, details: await instance.status() },
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "workflow create failed";
    await setStatus(env.DB, id, "failed", { error: message });
    const row = await getAsset(env.DB, id);
    return json(
      request,
      {
        ...(row ? withUrls(row, env.MEDIA_PUBLIC_ORIGIN) : { id, kind, original_key: key }),
        error: message,
      },
      { status: 500 },
    );
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
