// Pure helpers behind the thread's replies (no React Native imports, tested in node).

/** The comments in display order: each top-level comment followed by every
 * reply in its subtree, one level deep (as on Eve's Rhythm and X). A reply
 * whose parent is gone (hidden, deleted) shows as a top-level comment. Input
 * order (oldest first) is kept within each group. */
export function threadRows<T extends { id: string; parentId: string | null }>(
  comments: T[],
): { comment: T; depth: 0 | 1 }[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: T): string => {
    let current = c;
    const seen = new Set<string>();
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentId)!;
    }
    return current.id;
  };
  const replies = new Map<string, T[]>();
  const roots: T[] = [];
  for (const c of comments) {
    const root = rootOf(c);
    if (root === c.id) roots.push(c);
    else replies.set(root, [...(replies.get(root) ?? []), c]);
  }
  return roots.flatMap((root) => [
    { comment: root, depth: 0 as const },
    ...(replies.get(root.id) ?? []).map((comment) => ({ comment, depth: 1 as const })),
  ]);
}

const MENTION = /(^|[^\w@])(@([a-z0-9][a-z0-9_-]{1,29}))/gi;

/** The text cut into plain runs and `@handle` mentions (a mention starts the
 * text or follows a non-word character, so an email is not one). */
export function splitMentions(text: string): { text: string; handle?: string }[] {
  const parts: { text: string; handle?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const start = m.index! + m[1].length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: m[2], handle: m[3].toLowerCase() });
    last = start + m[2].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
