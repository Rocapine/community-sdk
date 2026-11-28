// Cache of signed Storage URLs, keyed by member and path. A leaf module so
// identity.ts can clear it on every identity change without an import cycle.

const cache = new Map<string, { url: string; until: number }>();

export function cachedSignedUrl(key: string): string | null {
  const hit = cache.get(key);
  return hit && hit.until > Date.now() ? hit.url : null;
}

export function cacheSignedUrl(key: string, url: string, ttlMs: number): void {
  cache.set(key, { url, until: Date.now() + ttlMs });
}

export function clearSignedUrls(): void {
  cache.clear();
}
