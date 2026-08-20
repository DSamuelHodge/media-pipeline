import { describe, expect, it } from "vitest";
import { kindFromMimeAndName, kindNeedsWorkflow, originalKey, resolveKind, sanitizedExtension } from "./kinds";
import { publicUrls } from "./urls";

describe("kindFromMimeAndName", () => {
  it("maps common types from MIME", () => {
    expect(kindFromMimeAndName("image/jpeg", "hero.jpg")).toBe("image");
    expect(kindFromMimeAndName("video/mp4", "clip.mp4")).toBe("video");
    expect(kindFromMimeAndName("audio/mp4", "memo.m4a")).toBe("audio");
    expect(kindFromMimeAndName("application/pdf", "scan.pdf")).toBe("pdf");
  });

  it("falls back to extension when mime is generic", () => {
    expect(kindFromMimeAndName("application/octet-stream", "voice.m4a")).toBe("audio");
    expect(kindFromMimeAndName("application/octet-stream", "notes.pdf")).toBe("pdf");
    expect(kindFromMimeAndName("application/octet-stream", "hero.png")).toBe("image");
  });

  it("decides webm from MIME, not extension", () => {
    expect(kindFromMimeAndName("video/webm", "clip.webm")).toBe("video");
    expect(kindFromMimeAndName("audio/webm", "voice.webm")).toBe("audio");
    expect(kindFromMimeAndName("application/octet-stream", "clip.webm")).toBe("video");
  });
});

describe("resolveKind", () => {
  it("ignores a client kind when inference succeeds", () => {
    expect(resolveKind("image/jpeg", "hero.jpg", "pdf")).toBe("image");
  });

  it("uses client kind only when inference returns null", () => {
    expect(resolveKind("application/octet-stream", "blob.bin", "pdf")).toBe("pdf");
    expect(resolveKind("application/octet-stream", "blob.bin", "nope")).toBeNull();
  });
});

describe("kindNeedsWorkflow", () => {
  it("is only audio and pdf", () => {
    expect(kindNeedsWorkflow("image")).toBe(false);
    expect(kindNeedsWorkflow("video")).toBe(false);
    expect(kindNeedsWorkflow("audio")).toBe(true);
    expect(kindNeedsWorkflow("pdf")).toBe(true);
  });
});

describe("keys and public urls", () => {
  it("builds original keys by kind", () => {
    expect(originalKey("image", "abc", "hero.PNG")).toBe("originals/images/abc.png");
    expect(originalKey("audio", "abc", "memo.m4a")).toBe("originals/audio/abc.m4a");
  });

  it("sanitizes unsafe extensions", () => {
    expect(sanitizedExtension('x.jpg"onclick="alert(1)')).toBe("");
    expect(originalKey("image", "abc", 'x.jpg"onclick="alert(1)')).toBe("originals/images/abc.jpg");
    expect(originalKey("pdf", "abc", "notes.pdf")).toBe("originals/pdfs/abc.pdf");
  });

  it("builds zone transform urls on the public origin", () => {
    const urls = publicUrls({
      origin: "https://media.hodgeluke.com/",
      kind: "image",
      originalKey: "originals/images/abc.jpg",
    });
    expect(urls.original).toBe("https://media.hodgeluke.com/originals/images/abc.jpg");
    expect(urls.display).toBe(
      "https://media.hodgeluke.com/cdn-cgi/image/width=1600,format=auto,quality=80/originals/images/abc.jpg",
    );
    expect(urls.thumbnail).toBe(
      "https://media.hodgeluke.com/cdn-cgi/image/width=400,height=400,fit=cover,format=auto,quality=80/originals/images/abc.jpg",
    );
  });

  it("builds video preview urls", () => {
    const urls = publicUrls({
      origin: "https://media.hodgeluke.com",
      kind: "video",
      originalKey: "originals/video/abc.mp4",
    });
    expect(urls.preview).toBe("https://media.hodgeluke.com/originals/video/abc.mp4");
  });

  it("omits derived urls when keys are missing", () => {
    const urls = publicUrls({
      origin: "https://media.hodgeluke.com",
      kind: "audio",
      originalKey: "originals/audio/abc.m4a",
      derivedTranscriptKey: "derived/transcripts/abc.md",
    });
    expect(urls.transcript).toBe("https://media.hodgeluke.com/derived/transcripts/abc.md");
    expect(urls.vtt).toBeUndefined();
  });
});
