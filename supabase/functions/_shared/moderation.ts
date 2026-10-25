// Shared moderation policy: OpenAI omni-moderation categories, score
// thresholds and the API call. Single source of truth for moderate-one,
// daily-moderation and update-profile.

// Categories that always hide a piece of content when OpenAI's own boolean
// flag is true, regardless of MODERATION_EXCLUDED_CATEGORIES below.
export const CATEGORIES_TO_HIDE = [
  "hate",
  "hate/threatening",
  "harassment",
  "harassment/threatening",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
];

// Comma-separated category list (e.g. "sexual,sexual/minors") an app can set
// to skip the supplementary raw-score check below for those categories —
// e.g. a wellness app allowing legitimate intimacy discussion sets
// MODERATION_EXCLUDED_CATEGORIES=sexual. The boolean check above still
// applies to every category regardless: this only silences the extra
// under-scored-content catch for the excluded ones. Default empty (no
// exclusion) — a neutral SDK default.
const EXCLUDED_CATEGORIES = new Set(
  (Deno.env.get("MODERATION_EXCLUDED_CATEGORIES") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean),
);

// Harm categories also hidden on a raw SCORE >= threshold, not just OpenAI's
// conservative boolean, to catch under-scored insults/harassment (incl. other
// languages). Starts from CATEGORIES_TO_HIDE, minus MODERATION_EXCLUDED_CATEGORIES.
export const SCORE_HIDE = CATEGORIES_TO_HIDE.filter((c) => !EXCLUDED_CATEGORIES.has(c));

const parsedThreshold = Number(Deno.env.get("MODERATION_SCORE_THRESHOLD"));
// Number("") is 0, and Number.isFinite(0) is true — without the > 0 guard an
// unset/blank env var silently sets the threshold to 0, which hides every
// piece of content instead of falling back to the 0.5 default.
export const SCORE_THRESHOLD =
  Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : 0.5;

export interface ModerationResult {
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
  // Per category, which input kinds the score was computed from.
  category_applied_input_types?: Record<string, ("text" | "image")[]>;
}

export function flaggedCategories(result: ModerationResult): string[] {
  const cats = new Set<string>();
  for (const [cat, v] of Object.entries(result.categories)) {
    if (v && CATEGORIES_TO_HIDE.includes(cat)) cats.add(cat);
  }
  for (const [cat, score] of Object.entries(result.category_scores)) {
    // Image-applied categories ignore MODERATION_EXCLUDED_CATEGORIES: the
    // exclusion exists for text discussion, never for pictures.
    const hide = result.category_applied_input_types?.[cat]?.includes("image")
      ? CATEGORIES_TO_HIDE
      : SCORE_HIDE;
    if (hide.includes(cat) && score >= SCORE_THRESHOLD) cats.add(cat);
  }
  return [...cats];
}

// Call once at module top-level in every function that moderates content
// (moderate-one, daily-moderation, update-profile) so a missing secret fails
// loudly at boot instead of degrading silently into "fail closed" forever
// (moderateInput would otherwise just log a 401 from OpenAI on every call).
export function assertModerationConfigured(): void {
  if (!Deno.env.get("OPENAI_API_KEY")) {
    throw new Error(
      "community-sdk: OPENAI_API_KEY is not set. Moderation cannot run — set it with " +
        "`supabase secrets set OPENAI_API_KEY=sk-...`.",
    );
  }
}

export type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

// Kept as an alias for update-profile (avatars).
export type ImageInput = ContentPart[];

// Text only => the plain string (unchanged request shape); with an image =>
// content parts (text part only when non-empty).
export function moderationParts(text: string, imageUrl: string | null): string | ContentPart[] {
  if (!imageUrl) return text;
  const image: ContentPart = { type: "image_url", image_url: { url: imageUrl } };
  return text ? [{ type: "text", text }, image] : [image];
}

// POSTs to OpenAI moderation. `input` is a string for text or a content-part
// array (image, optionally with text). `imageCategories` are the flagged
// categories applied to the image. Returns null on a non-OK response so the
// caller can fail closed (nothing published / nothing written).
export async function moderateInput(input: string | ContentPart[]): Promise<{
  flagged: boolean;
  reason: string | null;
  categories: string[];
  imageCategories: string[];
} | null> {
  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "omni-moderation-latest", input }),
  });
  if (!res.ok) {
    // Logged for ops (e.g. image_parse_error on a corrupt upload).
    console.error("moderation api error", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const { results } = await res.json();
  const result: ModerationResult = results[0];
  const categories = flaggedCategories(result);
  const imageCategories = categories.filter((c) =>
    result.category_applied_input_types?.[c]?.includes("image"),
  );
  return {
    flagged: categories.length > 0,
    reason: categories.length > 0 ? categories.join(",") : null,
    categories,
    imageCategories,
  };
}
