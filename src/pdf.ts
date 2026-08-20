const FIRECRAWL_MAX_BYTES = 50 * 1024 * 1024;

export type PdfParseResult = {
  markdown: string;
  source: "firecrawl" | "workers-ai";
  chars: number;
};

export async function workersAiPdfToMarkdown(ai: Ai, filename: string, bytes: ArrayBuffer): Promise<string> {
  const converted = await ai.toMarkdown({
    name: filename,
    blob: new Blob([bytes], { type: "application/pdf" }),
  });

  if (converted.format === "error") {
    throw new Error(converted.error || "workers-ai toMarkdown failed");
  }
  if (!converted.data.trim()) {
    throw new Error("workers-ai toMarkdown returned empty output");
  }
  return converted.data;
}

export async function firecrawlParse(opts: {
  apiKey: string;
  filename: string;
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<string> {
  if (opts.bytes.byteLength > FIRECRAWL_MAX_BYTES) {
    throw new Error(`pdf exceeds Firecrawl 50MB limit (${opts.bytes.byteLength} bytes)`);
  }

  const form = new FormData();
  form.set("file", new Blob([opts.bytes], { type: opts.contentType || "application/pdf" }), opts.filename);
  form.set(
    "options",
    new Blob(
      [
        JSON.stringify({
          formats: ["markdown"],
          parsers: [{ type: "pdf", mode: "auto" }],
        }),
      ],
      { type: "application/json" },
    ),
  );

  const response = await fetch("https://api.firecrawl.dev/v2/parse", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  const payload = (await response.json()) as {
    success?: boolean;
    data?: { markdown?: string };
    error?: string;
  };

  if (!response.ok || !payload.success || typeof payload.data?.markdown !== "string") {
    throw new Error(payload.error ?? `firecrawl parse failed (${response.status})`);
  }

  return payload.data.markdown;
}

export async function parsePdf(opts: {
  ai: Ai;
  firecrawlKey?: string;
  filename: string;
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<PdfParseResult> {
  if (opts.firecrawlKey) {
    try {
      const markdown = await firecrawlParse({
        apiKey: opts.firecrawlKey,
        filename: opts.filename,
        bytes: opts.bytes,
        contentType: opts.contentType,
      });
      return { markdown, source: "firecrawl", chars: markdown.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "firecrawl parse failed";
      console.error(JSON.stringify({ pdf: opts.filename, firecrawl: message }));
    }
  }

  const markdown = await workersAiPdfToMarkdown(opts.ai, opts.filename, opts.bytes);
  return { markdown, source: "workers-ai", chars: markdown.length };
}
