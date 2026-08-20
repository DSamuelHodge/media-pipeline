import { describe, expect, it } from "vitest";
import worker from "./index";
import { fakeD1, fakeR2, jsonRequest, makeEnv, sampleRow, TOKEN, uploadRequest } from "./test/env";

const fetchWorker = (request: Request, env: Env) => worker.fetch(request, env, {} as ExecutionContext);

describe("worker fetch", () => {
  it("answers OPTIONS and health", async () => {
    const env = makeEnv();
    const options = await fetchWorker(jsonRequest("/health", { method: "OPTIONS" }), env);
    expect(options.status).toBe(204);

    const health = await fetchWorker(jsonRequest("/health"), env);
    expect(await health.json()).toEqual({ ok: true });
  });

  it("lists assets and rejects a bad kind", async () => {
    const db = fakeD1([sampleRow(), sampleRow({ id: "a2", kind: "audio", original_key: "originals/audio/a2.m4a" })]);
    const env = makeEnv({ db });
    const bad = await fetchWorker(jsonRequest("/assets?kind=nope"), env);
    expect(bad.status).toBe(400);

    const listed = await fetchWorker(jsonRequest("/assets?kind=image&limit=bogus&offset=-3"), env);
    const body = (await listed.json()) as { assets: { id: string }[] };
    expect(body.assets).toHaveLength(1);

    const clamped = await fetchWorker(jsonRequest("/assets?limit=999&offset=0"), env);
    const all = (await clamped.json()) as { assets: unknown[] };
    expect(all.assets).toHaveLength(2);
  });

  it("shows an asset or 404", async () => {
    const env = makeEnv({ db: fakeD1([sampleRow()]) });
    const missing = await fetchWorker(jsonRequest("/assets/nope"), env);
    expect(missing.status).toBe(404);
    const found = await fetchWorker(jsonRequest("/assets/asset-1"), env);
    const body = (await found.json()) as { urls: { original: string } };
    expect(body.urls.original).toContain("media.hodgeluke.com");
  });

  it("reports status with and without a workflow", async () => {
    const env = makeEnv({
      db: fakeD1([
        sampleRow({ id: "ready" }),
        sampleRow({ id: "busy", workflow_id: "wf-1", status: "processing" }),
        sampleRow({ id: "lost", workflow_id: "missing", status: "uploaded" }),
      ]),
      workflowGet: async (id: string) => {
        if (id === "missing") throw new Error("gone");
        return { id, status: async () => ({ status: "running" }) };
      },
    });
    expect((await (await fetchWorker(jsonRequest("/assets/missing-row/status"), env)).json()) as { error: string }).toEqual({
      error: "not found",
    });
    expect(((await (await fetchWorker(jsonRequest("/assets/ready/status"), env)).json()) as { workflow: unknown }).workflow).toBeNull();
    const busy = (await (await fetchWorker(jsonRequest("/assets/busy/status"), env)).json()) as { workflow: { status: string } };
    expect(busy.workflow.status).toBe("running");
    const lost = (await (await fetchWorker(jsonRequest("/assets/lost/status"), env)).json()) as { workflow: { error: string } };
    expect(lost.workflow.error).toBe("workflow instance not found");
  });

  it("serves derived objects and their error states", async () => {
    const row = sampleRow({
      id: "pdf",
      kind: "pdf",
      derived_markdown_key: "derived/markdown/pdf.md",
      derived_transcript_key: "derived/transcripts/pdf.md",
    });
    const r2 = fakeR2({ "derived/markdown/pdf.md": "# hi" });
    const env = makeEnv({ db: fakeD1([row]), r2 });
    expect((await fetchWorker(jsonRequest("/assets/nope/markdown"), env)).status).toBe(404);
    expect((await fetchWorker(jsonRequest("/assets/pdf/vtt"), env)).status).toBe(409);
    expect((await fetchWorker(jsonRequest("/assets/pdf/transcript"), env)).status).toBe(404);
    const ok = await fetchWorker(jsonRequest("/assets/pdf/markdown"), env);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("# hi");
  });

  it("uploads images as ready without a workflow", async () => {
    const env = makeEnv();
    const res = await fetchWorker(await uploadRequest(new File([new Uint8Array([1, 2])], "hero.jpg", { type: "image/jpeg" }), { title: "Hero" }), env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; kind: string; workflow_id: string | null };
    expect(body.status).toBe("ready");
    expect(body.kind).toBe("image");
    expect(body.workflow_id).toBeNull();
  });

  it("falls back when the row cannot be re-read after an image insert", async () => {
    const db = fakeD1();
    db.hideNextSelect();
    const env = makeEnv({ db });
    const res = await fetchWorker(await uploadRequest(new File(["x"], "still.png", { type: "image/png" })), env);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "ready", kind: "image" });
  });

  it("uploads video as ready and audio as accepted", async () => {
    const env = makeEnv();
    const video = await fetchWorker(await uploadRequest(new File(["v"], "clip.mp4", { type: "video/mp4" })), env);
    expect(video.status).toBe(201);
    const audio = await fetchWorker(
      await uploadRequest(new File(["a"], "memo.m4a", { type: "audio/mp4" }), { title: "Walk notes" }),
      env,
    );
    expect(audio.status).toBe(202);
    const body = (await audio.json()) as { workflow: { id: string } };
    expect(body.workflow.id).toMatch(/^process-/);
  });

  it("records workflow create failure instead of returning 202", async () => {
    const env = makeEnv({
      workflowCreate: async () => {
        throw new Error("queue down");
      },
    });
    const res = await fetchWorker(await uploadRequest(new File(["p"], "notes.pdf", { type: "application/pdf" })), env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("queue down");
  });

  it("stringifies non-Error workflow failures and handles a missing row", async () => {
    const db = fakeD1();
    const env = makeEnv({
      db,
      workflowCreate: async () => {
        db.hideNextSelect();
        throw "nope";
      },
    });
    const res = await fetchWorker(await uploadRequest(new File(["p"], "scan.pdf", { type: "application/pdf" })), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "workflow create failed" });
  });

  it("validates upload input", async () => {
    const env = makeEnv();
    expect((await fetchWorker(jsonRequest("/upload", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), env)).status).toBe(400);

    const empty = new FormData();
    empty.set("title", "x");
    const noFile = await fetchWorker(
      new Request("https://ingest.hodgeluke.com/upload", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: empty,
      }),
      env,
    );
    expect(noFile.status).toBe(400);

    const unknown = await fetchWorker(await uploadRequest(new File(["z"], "blob.bin", { type: "application/octet-stream" })), env);
    expect(unknown.status).toBe(400);

    const forced = await fetchWorker(
      await uploadRequest(new File(["z"], "blob.bin", { type: "application/octet-stream" }), { kind: "pdf" }),
      env,
    );
    expect(forced.status).toBe(202);
  });

  it("rejects uploads without a configured or valid token", async () => {
    const none = await fetchWorker(jsonRequest("/upload", { method: "POST" }), makeEnv({ token: "" }));
    expect(none.status).toBe(500);
    const bad = await fetchWorker(
      jsonRequest("/upload", { method: "POST", headers: { authorization: "Bearer nope" } }),
      makeEnv(),
    );
    expect(bad.status).toBe(401);
  });

  it("serves static SITE, then R2, then 404", async () => {
    const hit = await fetchWorker(jsonRequest("/"), makeEnv({ siteStatus: 200, siteBody: "<html>ok</html>" }));
    expect(await hit.text()).toBe("<html>ok</html>");

    const r2 = fakeR2();
    await r2.put("originals/images/x.jpg", new Uint8Array([9, 9]), { httpMetadata: { contentType: "image/jpeg" } });
    const file = await fetchWorker(jsonRequest("/originals/images/x.jpg"), makeEnv({ r2, siteStatus: 404 }));
    expect(file.headers.get("content-type")).toBe("image/jpeg");

    const raw = fakeR2();
    await raw.put("plain", new Uint8Array([1]));
    const fallbackType = await fetchWorker(jsonRequest("/plain"), makeEnv({ r2: raw, siteStatus: 404 }));
    expect(fallbackType.headers.get("content-type")).toBe("application/octet-stream");

    expect((await fetchWorker(jsonRequest("/dir/"), makeEnv({ siteStatus: 404 }))).status).toBe(404);
    expect((await fetchWorker(jsonRequest("/missing-object"), makeEnv({ siteStatus: 404 }))).status).toBe(404);
  });

  it("maps thrown errors to 500", async () => {
    const boom = await fetchWorker(
      jsonRequest("/any"),
      makeEnv({
        siteStatus: 404,
      }),
    );
    // force a throw via SITE
    const env = makeEnv();
    env.SITE = {
      fetch: async () => {
        throw new Error("site down");
      },
    } as Fetcher;
    expect((await fetchWorker(jsonRequest("/page"), env)).status).toBe(500);

    env.SITE = {
      fetch: async () => {
        throw "broken";
      },
    } as Fetcher;
    const res = await fetchWorker(jsonRequest("/page"), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
    expect(boom.status).toBe(404);
  });
});
