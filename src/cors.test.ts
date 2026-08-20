import { describe, expect, it } from "vitest";
import { corsHeaders, json, withCors } from "./cors";

describe("corsHeaders", () => {
  it("reflects only named origins", () => {
    const allowed = corsHeaders(new Request("https://ingest.hodgeluke.com/assets", { headers: { origin: "https://dsamuelhodge.github.io" } }));
    expect(allowed["access-control-allow-origin"]).toBe("https://dsamuelhodge.github.io");

    const otherPages = corsHeaders(
      new Request("https://ingest.hodgeluke.com/assets", { headers: { origin: "https://evil.github.io" } }),
    );
    expect(otherPages["access-control-allow-origin"]).toBe("https://ingest.hodgeluke.com");

    const none = corsHeaders(new Request("https://ingest.hodgeluke.com/assets"));
    expect(none["access-control-allow-origin"]).toBe("https://ingest.hodgeluke.com");
  });

  it("wraps json and existing responses", async () => {
    const request = new Request("https://ingest.hodgeluke.com/health", { headers: { origin: "https://media.hodgeluke.com" } });
    const body = json(request, { ok: true }, { headers: { "x-test": "1" } });
    expect(body.headers.get("x-test")).toBe("1");
    expect(body.headers.get("access-control-allow-origin")).toBe("https://media.hodgeluke.com");
    expect(await body.json()).toEqual({ ok: true });

    const wrapped = withCors(request, new Response("hi", { status: 418, statusText: "Teapot" }));
    expect(wrapped.status).toBe(418);
    expect(wrapped.headers.get("access-control-allow-origin")).toBe("https://media.hodgeluke.com");
  });
});
