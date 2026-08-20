import { describe, expect, it } from "vitest";
import {
  countAssets,
  getAsset,
  insertAsset,
  kindCounts,
  listAssets,
  searchLike,
  setStatus,
  withUrls,
  type AssetRow,
} from "./catalog";
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

    expect(await countAssets(db as unknown as D1Database)).toBe(2);
    expect(await countAssets(db as unknown as D1Database, { kind: "audio" })).toBe(1);
    expect(await kindCounts(db as unknown as D1Database)).toEqual({
      all: 2,
      image: 1,
      video: 0,
      audio: 1,
      pdf: 0,
    });
    expect((await listAssets(db as unknown as D1Database, { q: "memo", limit: 10, offset: 0 })).map((row) => row.id)).toEqual([
      "a1",
    ]);
    expect(await countAssets(db as unknown as D1Database, { q: "Hero" })).toBe(1);
    expect((await kindCounts(db as unknown as D1Database, "hero")).image).toBe(1);
    db.rows.set("z", sampleRow({ id: "z", kind: "other" as AssetRow["kind"], filename: "z.bin" }));
    expect((await kindCounts(db as unknown as D1Database)).all).toBe(2);

    db.emptyAll();
    expect(await listAssets(db as unknown as D1Database, { limit: 10, offset: 0 })).toEqual([]);
    db.emptyAll();
    expect(await kindCounts(db as unknown as D1Database)).toEqual({
      all: 0,
      image: 0,
      video: 0,
      audio: 0,
      pdf: 0,
    });
    db.hideNextSelect();
    expect(await countAssets(db as unknown as D1Database)).toBe(0);

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

  it("escapes LIKE wildcards in search", () => {
    expect(searchLike(null)).toBeNull();
    expect(searchLike("  ")).toBeNull();
    expect(searchLike("100%_off")).toBe("%100\\%\\_off%");
    expect(searchLike("a".repeat(90))?.length).toBe(2 + 80);
  });

  it("attaches public urls", () => {
    const wrapped = withUrls(sampleRow({ kind: "pdf", derived_markdown_key: "derived/markdown/asset-1.md" }), "https://media.hodgeluke.com");
    expect(wrapped.urls.markdown).toBe("https://media.hodgeluke.com/derived/markdown/asset-1.md");
  });
});
