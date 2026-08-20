# Library

Personal media ingest for Hodge Luke: drop files, store originals, derive transcripts and markdown, browse a gallery.

| | |
|---|---|
| Site | https://ingest.hodgeluke.com |
| Files | https://media.hodgeluke.com |
| Agents | https://ingest.hodgeluke.com/llms.txt · [OpenAPI](https://ingest.hodgeluke.com/openapi.json) |
| Source | https://github.com/DSamuelHodge/media-pipeline |

GitHub holds the code. Cloudflare serves the Worker, the UI in `public/`, R2, D1, and Workflows. Never commit `UPLOAD_TOKEN` or `FIRECRAWL_API_KEY`.

## What happens on upload

| Kind | Original | Derived |
|---|---|---|
| Image | `originals/images/{id}.*` | Zone transforms on `media.hodgeluke.com/cdn-cgi/image/...` |
| Video | `originals/video/{id}.*` | Original (preview URL is the file) |
| Audio / `.m4a` | `originals/audio/{id}.*` | Whisper Large v3 Turbo → markdown + VTT |
| PDF | `originals/pdfs/{id}.pdf` | Firecrawl `/parse`, then Workers AI `toMarkdown` |

Images and video are **ready** at insert (`201`). Audio and PDFs return **202**; poll `GET /assets/{id}/status` until `ready` or `failed`.

## Human

1. Open https://ingest.hodgeluke.com
2. Paste the upload token once (`pass show cloudflare/media-pipeline/upload-token`). It stays in this browser.
3. Drop images, video, voice memos, or PDFs. Images and video appear immediately; audio and PDFs show in **In flight** until ready.
4. Open a card for preview, transcript, markdown, and public URLs.

Reads are public. The token is only required to upload.

## Agent

Call the HTTP API. Do not scrape the page.

```bash
TOKEN=$(pass show cloudflare/media-pipeline/upload-token | head -1)

curl -X POST https://ingest.hodgeluke.com/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./notes.pdf" \
  -F "title=Notes"

curl https://ingest.hodgeluke.com/assets
curl https://ingest.hodgeluke.com/assets/<id>/status
curl https://ingest.hodgeluke.com/assets/<id>/markdown
```

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | none |
| GET | `/assets?kind=&limit=&offset=` | none |
| GET | `/assets/{id}` | none |
| GET | `/assets/{id}/status` | none |
| GET | `/assets/{id}/markdown` | none (PDFs, when ready) |
| GET | `/assets/{id}/transcript` | none (audio, when ready) |
| GET | `/assets/{id}/vtt` | none |
| POST | `/upload` multipart `file`, optional `title`, `kind` | `Authorization: Bearer` |

Point an OpenAPI client at `/openapi.json`. Firecrawl MCP is the PDF engine; this API is the library.

## Layout

```
src/            Worker (upload, catalog, Whisper, Firecrawl)
public/         Static library UI
migrations/     D1 schema
wrangler.jsonc  Bindings: R2, D1, Workflows, Secrets Store, assets
```

R2 keys:

```
originals/{images|video|audio|pdfs}/{id}.{ext}
derived/markdown/{id}.md
derived/transcripts/{id}.md
derived/transcripts/{id}.vtt
```

## Secrets

| Where | Names |
|---|---|
| Worker secrets | `UPLOAD_TOKEN`, `FIRECRAWL_API_KEY` |
| Secrets Store | `MEDIA_PIPELINE_UPLOAD_TOKEN`, `MEDIA_PIPELINE_FIRECRAWL_API_KEY` |
| `pass` | `cloudflare/media-pipeline/upload-token`, `firecrawl/api-key` |
| Local only | `.dev.vars` (gitignored) |

```bash
cp .dev.vars.example .dev.vars
# UPLOAD_TOKEN=...
# FIRECRAWL_API_KEY=...
```

## Develop and deploy

```bash
npm install
npx wrangler d1 migrations apply personal-media --local
npm test
npx wrangler deploy
```

Production deploy uses Wrangler OAuth (`npx wrangler login --device`) or:

```bash
export CLOUDFLARE_API_TOKEN="$(pass show cloudflare/workers-ai | head -1)"
export CLOUDFLARE_ACCOUNT_ID="6c2dbbe47de58a74542ad9a5d9dd5b2b"
npx wrangler deploy
```

Image variants are zone transforms on the public origin:

```
https://media.hodgeluke.com/cdn-cgi/image/width=400,height=400,fit=cover,format=auto/{key}
```
