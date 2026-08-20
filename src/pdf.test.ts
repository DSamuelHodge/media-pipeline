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
