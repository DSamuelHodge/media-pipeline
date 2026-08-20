import { describe, expect, it } from "vitest";
import { requireUploadToken } from "./auth";

describe("requireUploadToken", () => {
  it("rejects when the token is not configured", async () => {
    const denied = await requireUploadToken(new Request("https://x/upload", { method: "POST" }), undefined);
    expect(denied?.status).toBe(500);
    expect(await denied?.json()).toEqual({ error: "UPLOAD_TOKEN is not configured" });
  });

  it("rejects missing bearer prefix", async () => {
    const denied = await requireUploadToken(
      new Request("https://x/upload", { method: "POST", headers: { authorization: "token abc" } }),
      "secret",
    );
    expect(denied?.status).toBe(401);
  });

  it("rejects the wrong token", async () => {
    const denied = await requireUploadToken(
      new Request("https://x/upload", { method: "POST", headers: { authorization: "Bearer nope" } }),
      "secret",
    );
    expect(denied?.status).toBe(401);
  });

  it("rejects a different-length token without comparing bytes", async () => {
    const denied = await requireUploadToken(
      new Request("https://x/upload", { method: "POST", headers: { authorization: "Bearer ab" } }),
      "secret",
    );
    expect(denied?.status).toBe(401);
  });

  it("accepts a matching bearer token", async () => {
    const denied = await requireUploadToken(
      new Request("https://x/upload", { method: "POST", headers: { authorization: "Bearer secret" } }),
      "secret",
    );
    expect(denied).toBeNull();
  });
});
