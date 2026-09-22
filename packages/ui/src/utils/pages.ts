// Flatten an infinite query's pages into one list, dropping duplicate post
// ids. Offset pagination (`range(page*20, …)`) on a live feed can hand back
// a row twice — e.g. after an optimistic post is prepended to page 0, or when
// someone else posts between two page fetches, page N+1 starts one row early —
// and a duplicate `id` breaks `FlatList`'s `keyExtractor` (key collision
// warning + a duplicated card). First occurrence wins (it is the newest page
// position the row was seen at).
export function uniqueById<T extends { id: string }>(
  pages: readonly (readonly T[])[] | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages ?? []) {
    for (const item of page) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
