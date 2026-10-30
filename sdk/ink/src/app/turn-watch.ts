// How runInTerminal watches the run it started through the view it renders,
// without a second stream: SessionView reports every change of its turns and
// a session that fails to load, and the run reads its own turn from them.
// Internal to the kit (not exported from the package root).

import { createContext } from "react";
import type { Turn } from "@stigmer/client";

/** What a watcher hears from a SessionView below it. */
export interface TurnWatch {
  /** The conversation's turns, each time they change. */
  readonly onTurns: (turns: readonly Turn[]) => void;
  /** The session could not be loaded. */
  readonly onLoadError: (error: Error) => void;
}

export const TurnWatchContext = createContext<TurnWatch | null>(null);
