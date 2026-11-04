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
