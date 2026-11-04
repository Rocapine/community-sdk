// The example's own content, to share into the community as attachments.
export type CatalogItem = {
  type: "recipe" | "session";
  id: string;
  emoji: string;
  title: string;
  meta: string;
};

export const CATALOG: CatalogItem[] = [
  {
    type: "recipe",
    id: "matcha-oats",
    emoji: "🍵",
    title: "Matcha overnight oats",
    meta: "10 min · 4 ingredients",
  },
  {
    type: "recipe",
    id: "lemon-pasta",
    emoji: "🍋",
    title: "Lemon ricotta pasta",
    meta: "20 min · 6 ingredients",
  },
  {
    type: "recipe",
    id: "berry-bowl",
    emoji: "🫐",
    title: "Berry protein bowl",
    meta: "5 min · 5 ingredients",
  },
  {
    type: "session",
    id: "morning-flow",
    emoji: "🧘",
    title: "Morning flow",
    meta: "12 min · Yoga",
  },
  { type: "session", id: "core-burn", emoji: "🔥", title: "Core burn", meta: "8 min · HIIT" },
];

export const findItem = (type: string, id: string) =>
  CATALOG.find((item) => item.type === type && item.id === id);
