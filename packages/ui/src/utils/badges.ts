// Which of a member's badges show at one place, in the app's declared order.
import type { BadgePlacement, MemberBadgeData, MemberBadges } from "@rocapine/community-core";

export function badgesFor(
  placement: BadgePlacement,
  declared: Record<string, { placements: readonly BadgePlacement[] }> | false | undefined,
  data: MemberBadges | undefined,
): { key: string; data: MemberBadgeData }[] {
  if (!declared || !data) return [];
  return Object.entries(declared)
    .filter(([key, def]) => def.placements.includes(placement) && data[key] != null)
    .map(([key]) => ({ key, data: data[key]! }));
}

/** The profile editor's switch for one badge: `badge.<id>.toggle`, else the badge's
 * `badge.<id>.label`, else its id. `t` returns the key itself when it has no string. */
export function badgeToggleLabel(t: (key: string) => string, id: string): string {
  for (const key of [`badge.${id}.toggle`, `badge.${id}.label`]) {
    const value = t(key);
    if (value !== key) return value;
  }
  return id;
}
