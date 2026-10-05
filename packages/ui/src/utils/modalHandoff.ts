// iOS can't present a native Modal while another one is up (or still
// dismissing): the second one never shows and leaves an invisible layer that
// swallows every touch. Posts render inside `ThreadSheet` (a Modal), and a
// host slot (e.g. a reaction button) may open its own Modal from there.
//
// `presentModal(open)` is how a post-level slot opens one safely: outside a
// sheet it just calls `open()`; inside `ThreadSheet` it closes the sheet and
// calls `open()` once the sheet is fully dismissed (the same handoff Report
// uses). `ThreadSheet` provides the sheet-aware version.
import { createContext } from "react";

export type PresentModal = (open: () => void) => void;

export const ModalHandoffContext = createContext<PresentModal>((open) => open());
