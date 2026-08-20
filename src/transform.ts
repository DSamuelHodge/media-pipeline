const ALLOWED_FITS = new Set(["scale-down", "contain", "pad", "squeeze", "cover", "crop"]);

export async function transformFromR2(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/i\//, "");
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    return new Response("bad transform path", { status: 400 });
  }
  const optionStr = rest.slice(0, slash);
  const key = decodeURIComponent(rest.slice(slash + 1));
  if (!key.startsWith("originals/") || key.includes("..")) {
    return new Response("forbidden key", { status: 403 });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const object = await env.ASSETS.get(key);
  if (!object?.body) {
    return new Response("not found", { status: 404 });
  }

  const parsed = parseOptions(optionStr);
  const format = outputFormat(request, parsed.format);

  try {
    const result = await env.IMAGES.input(object.body)
      .transform({
        width: parsed.width,
        height: parsed.height,
        fit: parsed.fit,
      })
      .output({ format, quality: parsed.quality });

    const response = result.response({
      headers: {
        "cache-control": "public, max-age=604800",
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "transform failed";
    console.error(JSON.stringify({ transform: key, error: message }));
    return Response.redirect(`${env.MEDIA_PUBLIC_ORIGIN.replace(/\/$/, "")}/${key}`, 302);
  }
}

function parseOptions(raw: string): {
  width?: number;
  height?: number;
  fit?: ImageTransform["fit"];
  format?: string;
  quality?: number;
} {
  const out: ReturnType<typeof parseOptions> = {};
  for (const part of raw.split(",")) {
    const [k, v] = part.split("=");
    if (!k || v === undefined) continue;
    if (k === "width") out.width = Number(v);
    else if (k === "height") out.height = Number(v);
    else if (k === "quality") out.quality = Number(v);
    else if (k === "format") out.format = v;
    else if (k === "fit" && ALLOWED_FITS.has(v)) out.fit = v as ImageTransform["fit"];
  }
  return out;
}

function outputFormat(
  request: Request,
  requested?: string,
): "image/jpeg" | "image/png" | "image/webp" | "image/avif" {
  if (requested && requested !== "auto") {
    if (requested === "webp") return "image/webp";
    if (requested === "avif") return "image/avif";
    if (requested === "png") return "image/png";
    return "image/jpeg";
  }
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("image/avif")) return "image/avif";
  if (accept.includes("image/webp")) return "image/webp";
  return "image/jpeg";
}
