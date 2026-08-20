import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getAsset, setStatus } from "./catalog";
import type { AssetKind } from "./kinds";
import { markdownKey, transcriptKey, vttKey } from "./kinds";
import { parsePdf } from "./pdf";
import { readSecret } from "./secrets";
import { transcriptMarkdown, transcribeAudio } from "./whisper";

export type ProcessAssetParams = {
  id: string;
  kind: AssetKind;
};

const STEP_RETRY = {
  retries: { limit: 3, delay: "20 seconds" as const, backoff: "exponential" as const },
  timeout: "15 minutes" as const,
};

export class ProcessAssetWorkflow extends WorkflowEntrypoint<Env, ProcessAssetParams> {
  async run(event: WorkflowEvent<ProcessAssetParams>, step: WorkflowStep) {
    const { id, kind } = event.payload;

    await step.do("mark processing", async () => {
      await setStatus(this.env.DB, id, "processing");
      return { id, kind };
    });

    try {
      if (kind === "audio") {
        await step.do("handle audio whisper", STEP_RETRY, async () => handleAudio(this.env, id));
      } else if (kind === "pdf") {
        await step.do("handle pdf parse", STEP_RETRY, async () => handlePdf(this.env, id));
      } else {
        await step.do("mark ready", async () => {
          await setStatus(this.env.DB, id, "ready", { error: null });
          return { id, kind };
        });
      }

      return { id, kind, status: "ready" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "processing failed";
      await step.do("mark failed", async () => {
        await setStatus(this.env.DB, id, "failed", { error: message });
        return { error: message };
      });
      throw error;
    }
  }
}

async function handleAudio(env: Env, id: string) {
  const asset = await requireAsset(env, id);
  const tKey = transcriptKey(id);
  const captionsKey = vttKey(id);
  const existingTranscript = await env.ASSETS.get(tKey);
  if (existingTranscript) {
    const extra: { derivedTranscriptKey: string; derivedVttKey?: string; error: null } = {
      error: null,
      derivedTranscriptKey: tKey,
    };
    if (await env.ASSETS.get(captionsKey)) {
      extra.derivedVttKey = captionsKey;
    }
    await setStatus(env.DB, id, "ready", extra);
    return { skipped: true, key: tKey };
  }

  const object = await env.ASSETS.get(asset.original_key);
  if (!object) {
    throw new Error(`missing original ${asset.original_key}`);
  }

  const whisper = await transcribeAudio(env.AI, await object.arrayBuffer());
  const title = asset.title || asset.filename;

  await env.ASSETS.put(tKey, transcriptMarkdown(title, whisper.text), {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
  if (whisper.vtt) {
    await env.ASSETS.put(captionsKey, whisper.vtt, {
      httpMetadata: { contentType: "text/vtt; charset=utf-8" },
    });
  }

  await setStatus(env.DB, id, "ready", {
    error: null,
    derivedTranscriptKey: tKey,
    ...(whisper.vtt ? { derivedVttKey: captionsKey } : {}),
  });

  return { key: tKey, chars: whisper.text.length, wordCount: whisper.word_count ?? null };
}

async function handlePdf(env: Env, id: string) {
  const asset = await requireAsset(env, id);
  const mdKey = markdownKey(id);
  const existing = await env.ASSETS.get(mdKey);
  if (existing) {
    await setStatus(env.DB, id, "ready", { error: null, derivedMarkdownKey: mdKey });
    return { skipped: true, key: mdKey };
  }

  const object = await env.ASSETS.get(asset.original_key);
  if (!object) {
    throw new Error(`missing original ${asset.original_key}`);
  }

  const parsed = await parsePdf({
    ai: env.AI,
    firecrawlKey: await readSecret(env.SECRET_FIRECRAWL_API_KEY, env.FIRECRAWL_API_KEY),
    filename: asset.filename,
    bytes: await object.arrayBuffer(),
    contentType: asset.content_type,
  });

  await env.ASSETS.put(mdKey, parsed.markdown, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
  await setStatus(env.DB, id, "ready", { error: null, derivedMarkdownKey: mdKey });

  return { key: mdKey, source: parsed.source, chars: parsed.chars };
}

async function requireAsset(env: Env, id: string) {
  const asset = await getAsset(env.DB, id);
  if (!asset) {
    throw new Error(`asset ${id} not found`);
  }
  return asset;
}
