import { describe, expect, it } from "vitest";
import { kindFromMimeAndName, originalKey } from "./kinds";
import { publicUrls } from "./urls";

describe("kindFromMimeAndName", () => {
  it("maps common types", () => {
    expect(kindFromMimeAndName("image/jpeg", "hero.jpg")).toBe("image");
    expect(kindFromMimeAndName("video/mp4", "clip.mp4")).toBe("video");
    expect(kindFromMimeAndName("audio/mp4", "memo.m4a")).toBe("audio");
    expect(kindFromMimeAndName("application/pdf", "scan.pdf")).toBe("pdf");
  });

  it("falls back to extension when mime is generic", () => {
    expect(kindFromMimeAndName("application/octet-stream", "voice.m4a")).toBe("audio");
    expect(kindFromMimeAndName("application/octet-stream", "notes.pdf")).toBe("pdf");
  });
});

describe("keys and public urls", () => {
  it("builds original keys by kind", () => {
    expect(originalKey("image", "abc", "hero.PNG")).toBe("originals/images/abc.png");
    expect(originalKey("audio", "abc", "memo.m4a")).toBe("originals/audio/abc.m4a");
  });

  it("builds transform urls from the public origin", () => {
    const urls = publicUrls({
      origin: "https://media.example.com/",
      transformOrigin: "https://ingest.hodgeluke.com",
      kind: "image",
      originalKey: "originals/images/abc.jpg",
    });
    expect(urls.original).toBe("https://media.example.com/originals/images/abc.jpg");
    expect(urls.display).toContain("/cdn-cgi/image/width=1600,format=auto,quality=80/originals/images/abc.jpg");
    expect(urls.thumbnail).toContain("width=400");
  });

  it("builds video preview urls", () => {
    const urls = publicUrls({
      origin: "https://media.example.com",
      kind: "video",
      originalKey: "originals/video/abc.mp4",
    });
    expect(urls.preview).toBe("https://media.example.com/originals/video/abc.mp4");
  });
});
