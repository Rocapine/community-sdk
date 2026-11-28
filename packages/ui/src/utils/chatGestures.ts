// The chat bubble's gesture rules (swipe to reply, the double tap's hit test): worklets,
// called from the gesture callbacks on the UI thread. Apart from utils/chat so a worklet
// captures only this small module.
//
// Two rules keep them working in every host build (see __tests__/worklets.test.ts):
// - `export const` arrows, never `export function`. tsc's CommonJS assigns
//   `exports.f = f` at the top of the file, relying on hoisting, and the worklets Babel
//   plugin turns a worklet function declaration into an unhoisted `var`: the export was
//   undefined (UI-thread "undefined is not a function", a web crash at load).
// - Worklets read only the local constants, never an exported binding (tsc compiles
//   that to `exports.X`, so the worklet would capture the module's whole `exports`).

const REPLY_AT = 64;
const MAX = 48;
const EDGE = 24;

/** The finger travel (pt) that triggers a reply. */
export const SWIPE_REPLY_AT = REPLY_AT;
/** How far the bubble follows the finger, at most (pt). */
export const SWIPE_MAX = MAX;
/** Touches starting this close to the screen's left edge belong to the system's back
 * swipe (iOS). */
export const SWIPE_EDGE = EDGE;

/** The bubble's offset for a finger travel `dx`: right only, half the travel, capped. */
export const swipeOffset = (dx: number): number => {
  "worklet";
  return Math.min(MAX, Math.max(0, dx) * 0.5);
};

/** Whether releasing at `dx` replies. */
export const swipeTriggered = (dx: number): boolean => {
  "worklet";
  return dx >= REPLY_AT;
};

/** The bubble's offset when the swipe arms (the reply icon is fully shown there). */
export const SWIPE_ARMED_OFFSET = swipeOffset(REPLY_AT);

/** Whether a touch at `x` (from the screen's left edge) is left to the back swipe. */
export const startsAtEdge = (x: number): boolean => {
  "worklet";
  return x < EDGE;
};

export type Rect = { x: number; y: number; width: number; height: number };

/** Whether a touch at (`x`, `y`) in the bubble lands on one of its own controls (the
 * like pill, the quote, an attachment card), `slop` points around each: those taps are
 * the control's, never half of a double tap. */
export const hitsControl = (
  x: number,
  y: number,
  rects: readonly (Rect | null)[],
  slop: number,
): boolean => {
  "worklet";
  for (const r of rects) {
    if (
      r &&
      x >= r.x - slop &&
      x <= r.x + r.width + slop &&
      y >= r.y - slop &&
      y <= r.y + r.height + slop
    )
      return true;
  }
  return false;
};
