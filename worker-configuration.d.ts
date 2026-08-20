/* eslint-disable */
// Bindings from wrangler.jsonc. Secrets are not in config; declare them here.
// `wrangler types` cannot finish on this machine (workerd needs macOS 13.5+).
interface Env {
  ASSETS: R2Bucket;
  SITE: Fetcher;
  DB: D1Database;
  AI: Ai;
  PROCESS_ASSET: Workflow<import("./src/workflow").ProcessAssetParams>;
  MEDIA_PUBLIC_ORIGIN: string;
  UPLOAD_TOKEN: string;
  FIRECRAWL_API_KEY?: string;
  SECRET_UPLOAD_TOKEN: SecretsStoreSecret;
  SECRET_FIRECRAWL_API_KEY: SecretsStoreSecret;
}

declare namespace Cloudflare {
  interface Env extends globalThis.Env {}
}
