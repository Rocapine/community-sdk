import { Platform, type TextStyle } from "react-native";

/** Spread into a text field's style: browsers draw a focus ring around web
 * inputs (`outline-style: auto`, which ignores `outlineWidth`); ours have their
 * own look. React Native's types have no "none" outline style, hence the cast. */
export const noFocusRing: TextStyle =
  Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : {};
