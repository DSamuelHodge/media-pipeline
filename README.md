# Library — Hodge Luke media pipeline

Personal ingest for images, video, voice memos, and PDFs.

- **Human site:** https://ingest.hodgeluke.com
- **Public files:** https://media.hodgeluke.com
- **Agent contract:** https://ingest.hodgeluke.com/llms.txt · https://ingest.hodgeluke.com/openapi.json

GitHub holds the source (Worker + static UI). Cloudflare serves it. Do **not** put `UPLOAD_TOKEN` in the repo or in GitHub Pages JS.

## What it does

| You drop | Stored | Derived |
|---|---|---|
| image | `originals/images/` | transform URLs on `media.hodgeluke.com` |
| video | `originals/video/` | original (media transforms if enabled on the zone) |
| audio / `.m4a` | `originals/audio/` | Whisper transcript + VTT |
| PDF | `originals/pdfs/` | Firecrawl markdown |

Upload returns `202`. Poll `/assets/{id}/status` until `ready` or `failed`.

## Human use

1. Open https://ingest.hodgeluke.com
2. Paste the upload token once (`pass show cloudflare/media-pipeline/upload-token`). It stays in this browser only.
3. Drop files. Watch **In flight**, then the gallery.
4. Click a card for preview, transcript, markdown, and copyable URLs.

Gallery reads are public. Token is only for upload.

## Agent / MCP use

Agents should call the HTTP API, not scrape the page. Same origin as the site.

```bash
TOKEN=$(pass show cloudflare/media-pipeline/upload-token | head -1)

curl -X POST https://ingest.hodgeluke.com/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./notes.pdf" \
  -F "title=Notes"

curl https://ingest.hodgeluke.com/assets/<id>/status
curl https://ingest.hodgeluke.com/assets/<id>/markdown
```

Point an MCP HTTP wrapper or any OpenAPI client at `https://ingest.hodgeluke.com/openapi.json`. Firecrawl MCP is separate (PDF engine); this API is the library.

## Why not GitHub Pages as the live app

A public GitHub Page cannot hold the upload token. The UI is static files in `public/` and **is** hosted by the Worker on ingest.hodgeluke.com. GitHub is the code host. If you enable GitHub Pages on `/public`, it will still talk to ingest (see `API_BASE` in `public/app.js`).

## Deploy

```bash
export CLOUDFLARE_API_TOKEN="$(pass show cloudflare/workers-ai | head -1)"
export CLOUDFLARE_ACCOUNT_ID="6c2dbbe47de58a74542ad9a5d9dd5b2b"
npx wrangler deploy
```

Secrets: Worker `UPLOAD_TOKEN` / `FIRECRAWL_API_KEY`, plus Secrets Store `MEDIA_PIPELINE_*`.
