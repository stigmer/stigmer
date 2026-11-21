// The one test for whether a step may sit in a folded stretch, shared by
// every place that folds steps out of sight: the working turn's stretch
// (MessageThread.tsx) and a plan's loose steps (PlanSteps.tsx). A step stays
// in view while it is still news: still running, running on in the
// background, failed, or holding a host's card (a host registers a card for a
// call the person should see).

import { isBackgroundRunning, stepTense, type ToolUse } from "@stigmer/client";
import { holdsToolCard, type HasToolCard } from "./tool-card.js";

/**
 * Whether a step may fold: it returned, runs nothing on in the background,
 * did not fail, and neither it nor a helper step under it has a host card.
 *
 * @internal
 */
export function foldsQuietly(tool: ToolUse, hasCard: HasToolCard): boolean {
  return tool.result !== undefined && !isBackgroundRunning(tool) && stepTense(tool) !== "failed" && !holdsToolCard(tool, hasCard);
}
