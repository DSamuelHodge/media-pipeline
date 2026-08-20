import { describe, expect, it } from "vitest";
import { getAsset, insertAsset, listAssets, setStatus, withUrls } from "./catalog";
import { fakeD1, sampleRow } from "./test/env";

describe("catalog", () => {
  it("inserts, reads, lists, and updates with COALESCE extras", async () => {
    const db = fakeD1();
    await insertAsset(db as unknown as D1Database, {
      id: "a1",
      kind: "audio",
      title: "Memo",
      filename: "memo.m4a",
      content_type: "audio/mp4",
      size: 10,
      original_key: "originals/audio/a1.m4a",
      status: "uploaded",
      workflow_id: "process-a1",
    });
    await insertAsset(db as unknown as D1Database, {
      id: "i1",
      kind: "image",
      title: "Hero",
      filename: "hero.jpg",
      content_type: "image/jpeg",
      size: 4,
      original_key: "originals/images/i1.jpg",
      status: "ready",
      workflow_id: null,
    });

    expect((await getAsset(db as unknown as D1Database, "a1"))?.filename).toBe("memo.m4a");
    expect(await getAsset(db as unknown as D1Database, "missing")).toBeNull();

    const all = await listAssets(db as unknown as D1Database, { limit: 10, offset: 0 });
    expect(all.map((row) => row.id).sort()).toEqual(["a1", "i1"]);

    const images = await listAssets(db as unknown as D1Database, { kind: "image", limit: 10, offset: 0 });
    expect(images).toHaveLength(1);
    expect(images[0]?.kind).toBe("image");

    db.emptyAll();
    expect(await listAssets(db as unknown as D1Database, { limit: 10, offset: 0 })).toEqual([]);

    await setStatus(db as unknown as D1Database, "a1", "ready", {
      error: null,
      derivedTranscriptKey: "derived/transcripts/a1.md",
    });
    const ready = await getAsset(db as unknown as D1Database, "a1");
    expect(ready?.status).toBe("ready");
    expect(ready?.derived_transcript_key).toBe("derived/transcripts/a1.md");
    expect(ready?.workflow_id).toBe("process-a1");

    await setStatus(db as unknown as D1Database, "a1", "failed", { error: "boom", workflowId: "other" });
    const failed = await getAsset(db as unknown as D1Database, "a1");
    expect(failed?.error).toBe("boom");
    expect(failed?.workflow_id).toBe("other");
    expect(failed?.derived_transcript_key).toBe("derived/transcripts/a1.md");
  });

  it("attaches public urls", () => {
    const wrapped = withUrls(sampleRow({ kind: "pdf", derived_markdown_key: "derived/markdown/asset-1.md" }), "https://media.hodgeluke.com");
    expect(wrapped.urls.markdown).toBe("https://media.hodgeluke.com/derived/markdown/asset-1.md");
  });
});
