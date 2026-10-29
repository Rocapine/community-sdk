import { Platform, type TextStyle } from "react-native";

/** Spread into a text field's style: browsers draw a focus ring around web
 * inputs (`outline-style: auto`, which ignores `outlineWidth`); ours have their
 * own look. React Native's types have no "none" outline style, hence the cast. */
export const noFocusRing: TextStyle =
  Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : {};

/** The same, for a `multiline` field: the web draws it as a `<textarea>` two
 * rows tall whatever it holds; this sizes it to its text instead (browsers
 * without `field-sizing` keep the two rows). */
export const noFocusRingMultiline: TextStyle =
  Platform.OS === "web"
    ? ({ outlineStyle: "none", fieldSizing: "content" } as unknown as TextStyle)
    : {};
