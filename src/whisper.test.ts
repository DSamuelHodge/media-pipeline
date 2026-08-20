import { describe, expect, it } from "vitest";
import { transcriptMarkdown, transcribeAudio } from "./whisper";

describe("transcribeAudio", () => {
  it("returns whisper output", async () => {
    const ai = {
      run: async () => ({ text: "hello", vtt: "WEBVTT", word_count: 1 }),
    } as unknown as Ai;
    const out = await transcribeAudio(ai, new Uint8Array([1, 2, 3]).buffer);
    expect(out.text).toBe("hello");
  });

  it("base64-encodes large buffers in chunks", async () => {
    const seen: string[] = [];
    const ai = {
      run: async (_model: string, input: { audio: string }) => {
        seen.push(input.audio);
        return { text: "ok" };
      },
    } as unknown as Ai;
    const bytes = new Uint8Array(0x8000 + 24);
    bytes.fill(65);
    await transcribeAudio(ai, bytes.buffer);
    expect(seen[0]?.length).toBeGreaterThan(100);
  });

  it("throws when whisper returns no text", async () => {
    const ai = { run: async () => ({}) } as unknown as Ai;
    await expect(transcribeAudio(ai, new ArrayBuffer(4))).rejects.toThrow("whisper returned no transcription");
  });
});

describe("transcriptMarkdown", () => {
  it("wraps trimmed text", () => {
    expect(transcriptMarkdown("Memo", "  hi  ")).toBe("# Memo\n\nhi\n");
  });
});
