// A post or comment "…" menu's alert buttons as rows of the menu sheet (`useActionMenu`,
// Android): Cancel is dropped, the sheet has its own row and dismisses on back and on
// a tap outside.
import type { AlertButton } from "react-native";
import type { MessageMenuAction } from "../components/chat/MessageMenu";

export const menuActions = (buttons: AlertButton[]): MessageMenuAction[] =>
  buttons
    .filter((b) => b.style !== "cancel")
    .map((b, i) => ({
      key: String(i),
      label: b.text ?? "",
      destructive: b.style === "destructive",
      onPress: () => void b.onPress?.(),
    }));
