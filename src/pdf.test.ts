import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePdf } from "./pdf";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeAi(markdown: string): Ai {
  return {
    toMarkdown: async () => ({ format: "markdown", data: markdown }),
  } as unknown as Ai;
}

describe("parsePdf", () => {
  it("uses Workers AI when Firecrawl is not configured", async () => {
    const result = await parsePdf({
      ai: fakeAi("# from workers"),
      filename: "notes.pdf",
      bytes: new ArrayBuffer(8),
      contentType: "application/pdf",
    });
    expect(result).toEqual({ markdown: "# from workers", source: "workers-ai", chars: 14 });
  });

  it("falls back to Workers AI when Firecrawl fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false, error: "boom" }), { status: 502 })),
    );
    const result = await parsePdf({
      ai: fakeAi("# from workers"),
      firecrawlKey: "fc-test",
      filename: "notes.pdf",
      bytes: new ArrayBuffer(8),
      contentType: "application/pdf",
    });
    expect(result.source).toBe("workers-ai");
    expect(result.markdown).toBe("# from workers");
  });

  it("falls back from an oversized Firecrawl payload, then rejects empty Workers AI output", async () => {
    const tooBig = new ArrayBuffer(50 * 1024 * 1024 + 1);
    const aiEmpty = {
      toMarkdown: async () => ({ format: "markdown", data: "   " }),
    } as unknown as Ai;
    await expect(
      parsePdf({ ai: aiEmpty, firecrawlKey: "fc-test", filename: "huge.pdf", bytes: tooBig, contentType: "application/pdf" }),
    ).rejects.toThrow("empty output");
  });

  it("surfaces Workers AI format errors", async () => {
    const ai = {
      toMarkdown: async () => ({ format: "error", error: "bad pdf" }),
    } as unknown as Ai;
    await expect(
      parsePdf({ ai, filename: "notes.pdf", bytes: new ArrayBuffer(4), contentType: "application/pdf" }),
    ).rejects.toThrow("bad pdf");

    const aiNoMessage = {
      toMarkdown: async () => ({ format: "error" }),
    } as unknown as Ai;
    await expect(
      parsePdf({ ai: aiNoMessage as unknown as Ai, filename: "notes.pdf", bytes: new ArrayBuffer(4), contentType: "application/pdf" }),
    ).rejects.toThrow("workers-ai toMarkdown failed");
  });

  it("falls back when Firecrawl returns a body without markdown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })));
    const result = await parsePdf({
      ai: fakeAi("# from workers"),
      firecrawlKey: "fc-test",
      filename: "notes.pdf",
      bytes: new ArrayBuffer(8),
      contentType: "application/pdf",
    });
    expect(result.source).toBe("workers-ai");
  });

  it("falls back when Firecrawl throws a non-Error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw "network";
    }));
    const result = await parsePdf({
      ai: fakeAi("# from workers"),
      firecrawlKey: "fc-test",
      filename: "notes.pdf",
      bytes: new ArrayBuffer(8),
      contentType: "application/pdf",
    });
    expect(result.source).toBe("workers-ai");
  });

  it("uses Firecrawl when it succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true, data: { markdown: "# from firecrawl" } }), { status: 200 }),
      ),
    );
    const result = await parsePdf({
      ai: fakeAi("# unused"),
      firecrawlKey: "fc-test",
      filename: "notes.pdf",
      bytes: new ArrayBuffer(8),
      contentType: "application/pdf",
    });
    expect(result).toEqual({ markdown: "# from firecrawl", source: "firecrawl", chars: 16 });
  });
});
