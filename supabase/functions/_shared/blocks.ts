// Members blocked either way with `uid` (core/016_mutual_blocks.sql): a push
// never names, counts or comes from one of them. Service-role client, so both
// directions are readable.
export async function blockedWith(
  supabase: { from: (table: string) => any },
  uid: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${uid},blocked_id.eq.${uid}`);
  return new Set(
    ((data ?? []) as { blocker_id: string; blocked_id: string }[]).map((b) =>
      b.blocker_id === uid ? b.blocked_id : b.blocker_id,
    ),
  );
}
