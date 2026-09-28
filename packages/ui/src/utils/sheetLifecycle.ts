// What `CommunitySheet` must do when its parent's `visible` prop changes.
// Kept out of `Sheet.tsx` so it is unit-testable without React Native.
//
// Phases: "hidden" (nothing rendered), "open" (Modal up; the gorhom sheet is
// open or animating closed), "dismissing" (gorhom closed, the RN Modal is
// being dismissed natively — iOS only).
//  - "mount": hidden → mount the Modal; gorhom opens at index 0.
//  - "close": animate closed; gorhom's `onClose` then dismisses the Modal.
//  - "reopen": `visible` came back while the close animation was still
//    running → snap back open instead of remounting.
// A re-open requested while "dismissing" is deferred until the Modal is gone
// (handled by the sheet itself, not here): presenting during a dismissal is
// silently refused by iOS.
export type SheetPhase = "hidden" | "open" | "dismissing";
export type SheetAction = "mount" | "close" | "reopen" | null;

export function sheetTransition(
  prevVisible: boolean,
  visible: boolean,
  phase: SheetPhase,
): SheetAction {
  if (prevVisible === visible || phase === "dismissing") return null;
  if (!visible) return phase === "open" ? "close" : null;
  return phase === "open" ? "reopen" : "mount";
}
