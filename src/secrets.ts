type SecretBinding = string | { get(): Promise<string> } | undefined;

export async function readSecret(store: SecretBinding, fallback?: string): Promise<string | undefined> {
  if (store && typeof store !== "string") {
    const value = await store.get();
    if (value) return value;
  }
  if (typeof store === "string" && store) return store;
  if (fallback) return fallback;
  return undefined;
}
