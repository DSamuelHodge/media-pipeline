import { describe, expect, it } from "vitest";
import { ProcessAssetWorkflow } from "./workflow";
import { fakeD1, fakeR2, makeEnv, passThroughStep, sampleRow } from "./test/env";
import { markdownKey, transcriptKey, vttKey } from "./kinds";

function workflow(env: Env) {
  return new ProcessAssetWorkflow({} as ExecutionContext, env);
}

describe("ProcessAssetWorkflow", () => {
  it("marks leftover image kinds ready", async () => {
    const db = fakeD1([sampleRow({ id: "img", kind: "image", status: "uploaded" })]);
    const env = makeEnv({ db });
    const result = await workflow(env).run({ payload: { id: "img", kind: "image" } }, passThroughStep);
    expect(result).toEqual({ id: "img", kind: "image", status: "ready" });
    expect(db.rows.get("img")?.status).toBe("ready");
  });

  it("transcribes audio and stores vtt when present", async () => {
    const id = "aud";
    const db = fakeD1([
      sampleRow({
        id,
        kind: "audio",
        title: "Walk",
        filename: "walk.m4a",
        original_key: "originals/audio/aud.m4a",
        status: "uploaded",
      }),
    ]);
    const r2 = fakeR2({ "originals/audio/aud.m4a": new Uint8Array([1, 2, 3, 4]).buffer });
    const env = makeEnv({ db, r2 });
    await workflow(env).run({ payload: { id, kind: "audio" } }, passThroughStep);
    expect(db.rows.get(id)?.derived_transcript_key).toBe(transcriptKey(id));
    expect(db.rows.get(id)?.derived_vtt_key).toBe(vttKey(id));
    expect(new TextDecoder().decode((await r2.get(transcriptKey(id)))?.body as ArrayBuffer)).toContain("# Walk");
  });

  it("does not claim a vtt that was not written", async () => {
    const id = "aud2";
    const db = fakeD1([
      sampleRow({
        id,
        kind: "audio",
        title: null,
        filename: "walk.m4a",
        original_key: "originals/audio/aud2.m4a",
        status: "uploaded",
      }),
    ]);
    const r2 = fakeR2({ "originals/audio/aud2.m4a": new Uint8Array([9]).buffer });
    const env = makeEnv({
      db,
      r2,
      ai: { run: async () => ({ text: "only text" }), toMarkdown: async () => ({ format: "markdown", data: "x" }) } as unknown as Ai,
    });
    await workflow(env).run({ payload: { id, kind: "audio" } }, passThroughStep);
    expect(db.rows.get(id)?.derived_transcript_key).toBe(transcriptKey(id));
    expect(db.rows.get(id)?.derived_vtt_key).toBeNull();
  });

  it("skips audio when a transcript already exists, and only sets vtt if the object exists", async () => {
    const id = "skip-a";
    const db = fakeD1([
      sampleRow({
        id,
        kind: "audio",
        original_key: "originals/audio/skip-a.m4a",
        status: "uploaded",
      }),
    ]);
    const r2 = fakeR2({ [transcriptKey(id)]: "# already" });
    const env = makeEnv({ db, r2 });
    const result = await workflow(env).run({ payload: { id, kind: "audio" } }, passThroughStep);
    expect(result).toMatchObject({ status: "ready" });
    expect(db.rows.get(id)?.derived_vtt_key).toBeNull();

    await r2.put(vttKey(id), "WEBVTT");
    await workflow(env).run({ payload: { id, kind: "audio" } }, passThroughStep);
    expect(db.rows.get(id)?.derived_vtt_key).toBe(vttKey(id));
  });

  it("parses pdfs and skips when markdown already exists", async () => {
    const id = "pdf1";
    const db = fakeD1([
      sampleRow({
        id,
        kind: "pdf",
        filename: "notes.pdf",
        content_type: "application/pdf",
        original_key: "originals/pdfs/pdf1.pdf",
        status: "uploaded",
      }),
    ]);
    const r2 = fakeR2({ "originals/pdfs/pdf1.pdf": new Uint8Array([1]).buffer });
    const env = makeEnv({ db, r2 });
    await workflow(env).run({ payload: { id, kind: "pdf" } }, passThroughStep);
    expect(db.rows.get(id)?.derived_markdown_key).toBe(markdownKey(id));

    const skipped = await workflow(env).run({ payload: { id, kind: "pdf" } }, passThroughStep);
    expect(skipped).toMatchObject({ status: "ready" });
  });

  it("marks failed when the original is missing", async () => {
    const db = fakeD1([
      sampleRow({
        id: "gone",
        kind: "audio",
        original_key: "originals/audio/gone.m4a",
        status: "uploaded",
      }),
    ]);
    const env = makeEnv({ db, r2: fakeR2() });
    await expect(workflow(env).run({ payload: { id: "gone", kind: "audio" } }, passThroughStep)).rejects.toThrow(
      "missing original",
    );
    expect(db.rows.get("gone")?.status).toBe("failed");
  });

  it("marks failed when the asset row is missing", async () => {
    const env = makeEnv({ db: fakeD1() });
    await expect(workflow(env).run({ payload: { id: "nope", kind: "pdf" } }, passThroughStep)).rejects.toThrow(
      "asset nope not found",
    );
  });

  it("stringifies non-Error failures", async () => {
    const db = fakeD1([
      sampleRow({
        id: "pdf-bad",
        kind: "pdf",
        original_key: "originals/pdfs/pdf-bad.pdf",
        filename: "notes.pdf",
        content_type: "application/pdf",
        status: "uploaded",
      }),
    ]);
    const r2 = fakeR2({ "originals/pdfs/pdf-bad.pdf": new Uint8Array([1]).buffer });
    const env = makeEnv({
      db,
      r2,
      ai: {
        toMarkdown: async () => {
          throw "nope";
        },
      } as unknown as Ai,
    });
    await expect(workflow(env).run({ payload: { id: "pdf-bad", kind: "pdf" } }, passThroughStep)).rejects.toBe("nope");
    expect(db.rows.get("pdf-bad")?.error).toBe("processing failed");
  });
});
