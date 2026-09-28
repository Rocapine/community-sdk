// What `CommunitySheet` must do when its parent's `visible` prop changes.
// Kept out of `Sheet.tsx` so it is unit-testable without React Native.
//  - "mount": not on screen → mount the Modal; gorhom opens at index 0.
//  - "close": animate closed; gorhom's `onClose` then unmounts the Modal.
//  - "reopen": `visible` came back while the close animation was still
//    running (Modal still mounted) → snap back open instead of remounting.
export type SheetAction = "mount" | "close" | "reopen" | null;

export function sheetTransition(
  prevVisible: boolean,
  visible: boolean,
  mounted: boolean,
): SheetAction {
  if (prevVisible === visible) return null;
  if (!visible) return mounted ? "close" : null;
  return mounted ? "reopen" : "mount";
}
