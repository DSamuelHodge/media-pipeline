import { describe, expect, it } from "vitest";
import { corsHeaders } from "./cors";

describe("corsHeaders", () => {
  it("reflects only named origins", () => {
    const allowed = corsHeaders(new Request("https://ingest.hodgeluke.com/assets", { headers: { origin: "https://dsamuelhodge.github.io" } }));
    expect(allowed["access-control-allow-origin"]).toBe("https://dsamuelhodge.github.io");

    const otherPages = corsHeaders(
      new Request("https://ingest.hodgeluke.com/assets", { headers: { origin: "https://evil.github.io" } }),
    );
    expect(otherPages["access-control-allow-origin"]).toBe("https://ingest.hodgeluke.com");
  });
});
