import type { AssetKind } from "./kinds";

export type PublicUrls = {
  original: string;
  thumbnail?: string;
  display?: string;
  preview?: string;
  markdown?: string;
  transcript?: string;
  vtt?: string;
};

function joinOrigin(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export function publicUrls(input: {
  origin: string;
  kind: AssetKind;
  originalKey: string;
  derivedMarkdownKey?: string | null;
  derivedTranscriptKey?: string | null;
  derivedVttKey?: string | null;
}): PublicUrls {
  const origin = input.origin.replace(/\/$/, "");
  const original = joinOrigin(origin, input.originalKey);
  const urls: PublicUrls = { original };

  if (input.kind === "image") {
    urls.thumbnail = `${origin}/cdn-cgi/image/width=400,height=400,fit=cover,format=auto,quality=80/${input.originalKey}`;
    urls.display = `${origin}/cdn-cgi/image/width=1600,format=auto,quality=80/${input.originalKey}`;
  }

  if (input.kind === "video") {
    urls.preview = original;
  }

  if (input.derivedMarkdownKey) {
    urls.markdown = joinOrigin(origin, input.derivedMarkdownKey);
  }
  if (input.derivedTranscriptKey) {
    urls.transcript = joinOrigin(origin, input.derivedTranscriptKey);
  }
  if (input.derivedVttKey) {
    urls.vtt = joinOrigin(origin, input.derivedVttKey);
  }

  return urls;
}
