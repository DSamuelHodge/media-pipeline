import { describe, expect, it } from "vitest";
import { readSecret } from "./secrets";

describe("readSecret", () => {
  it("prefers a store binding with a value", async () => {
    expect(await readSecret({ get: async () => "from-store" }, "fallback")).toBe("from-store");
  });

  it("falls through an empty store to a string binding", async () => {
    expect(await readSecret("plain", "fallback")).toBe("plain");
  });

  it("uses fallback when store is empty", async () => {
    expect(await readSecret({ get: async () => "" }, "fallback")).toBe("fallback");
  });

  it("returns undefined when nothing is set", async () => {
    expect(await readSecret(undefined)).toBeUndefined();
    expect(await readSecret("")).toBeUndefined();
  });
});
