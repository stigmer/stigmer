// Where a run of steps sits, for the steps in it: in a card of steps, one
// row each with a hairline between them; or on a rail under a plan's to-do
// or a helper, where the rail is the inset and nothing divides the rows. A
// helper's own steps also leave their time to the helper's line, as its
// drawing does (the session page, S43). `ToolCallGroup` provides it; the
// step rows read it.
//
// Internal: not exported from the barrel.

import { createContext, useContext } from "react";

/** Where a run of steps sits. */
export interface StepPlace {
  /** Rows of a card, divided; or rows on a rail, undivided. */
  readonly rows: "card" | "rail";
  /** Inside a helper's body: its steps carry no time of their own. */
  readonly inHelper: boolean;
}

const IN_A_CARD: StepPlace = { rows: "card", inHelper: false };

/** Where the steps below sit. */
export const StepPlaceContext = createContext<StepPlace>(IN_A_CARD);

/** Where this step sits. */
export function useStepPlace(): StepPlace {
  return useContext(StepPlaceContext);
}
