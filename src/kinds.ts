export const KINDS = ["image", "video", "audio", "pdf"] as const;
export type AssetKind = (typeof KINDS)[number];

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif", "bmp", "svg"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "mkv"]);
const AUDIO_EXT = new Set(["m4a", "mp3", "wav", "ogg", "opus", "aac", "flac"]);
const PDF_EXT = new Set(["pdf"]);
const SAFE_EXT = /^[a-z0-9]{1,8}$/;

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export function sanitizedExtension(filename: string): string {
  const ext = extensionOf(filename);
  return SAFE_EXT.test(ext) ? ext : "";
}

export function isKind(value: string | null | undefined): value is AssetKind {
  return value !== null && value !== undefined && (KINDS as readonly string[]).includes(value);
}

export function kindFromMimeAndName(contentType: string, filename: string): AssetKind | null {
  const mime = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  const ext = sanitizedExtension(filename);

  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  if (PDF_EXT.has(ext)) return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

export function resolveKind(
  contentType: string,
  filename: string,
  requested?: string | null,
): AssetKind | null {
  return kindFromMimeAndName(contentType, filename) ?? (isKind(requested) ? requested : null);
}

export function kindNeedsWorkflow(kind: AssetKind): boolean {
  return kind === "audio" || kind === "pdf";
}

const ORIGINAL_FOLDERS: Record<AssetKind, string> = {
  image: "images",
  video: "video",
  audio: "audio",
  pdf: "pdfs",
};

export function originalKey(kind: AssetKind, id: string, filename: string): string {
  const ext = sanitizedExtension(filename) || fallbackExt(kind);
  return `originals/${ORIGINAL_FOLDERS[kind]}/${id}.${ext}`;
}

export function markdownKey(id: string): string {
  return `derived/markdown/${id}.md`;
}

export function transcriptKey(id: string): string {
  return `derived/transcripts/${id}.md`;
}

export function vttKey(id: string): string {
  return `derived/transcripts/${id}.vtt`;
}

function fallbackExt(kind: AssetKind): string {
  switch (kind) {
    case "image":
      return "jpg";
    case "video":
      return "mp4";
    case "audio":
      return "m4a";
    case "pdf":
      return "pdf";
  }
}
