// Pure display logic for translated items (CommunityPost, CommentRow), kept
// out of the components so it is unit-testable without React Native.
import type { TFn } from "../i18n";

export type Translatable = {
  text: string;
  translation: { text: string; sourceLocale: string } | null;
};

export function displayText(item: Translatable, showOriginal: boolean): string {
  return item.translation && !showOriginal ? item.translation.text : item.text;
}

/** "Translated from English · See original" / "Original · See translation"; null when untranslated. */
export function translationLine(t: TFn, item: Translatable, showOriginal: boolean): string | null {
  if (!item.translation) return null;
  // "und" (undetermined) shows up for short/emoji-only text with no detectable
  // language; naming it in the caption ("Translated from und") is worse than
  // no caption, so the text still displays (via displayText) but without a line.
  if (item.translation.sourceLocale === "und") return null;
  if (showOriginal) return `${t("translation.original")} · ${t("translation.showTranslation")}`;
  const key = `language.${item.translation.sourceLocale}`;
  const named = t(key);
  const language = named === key ? item.translation.sourceLocale : named;
  return `${t("translation.translatedFrom", { language })} · ${t("translation.showOriginal")}`;
}
