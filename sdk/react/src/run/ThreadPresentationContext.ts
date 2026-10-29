// How a thread's rows are presented beyond their own data: whether a
// stretch of settled tool calls folds into one step row, and what closes an
// ended turn. MessageThread provides it from its props, so the options
// reach the rows of both the plain and the virtualized list without
// threading through either (the pattern of FilePathContext and
// FileReviewContext beside it).

import { createContext, useContext, type ReactNode } from "react";
import type { Turn } from "@stigmer/client";

/** What MessageThread hands its rows. */
export interface ThreadPresentation {
  /** Fold a stretch of settled tool calls into one step row a click opens. */
  readonly foldSettledSteps: boolean;
  /** What closes an ended turn; undefined renders nothing there. */
  readonly turnOutcome?: (turn: Turn) => ReactNode;
}

const DEFAULT: ThreadPresentation = { foldSettledSteps: false };

/** @internal Provided by MessageThread. */
export const ThreadPresentationContext = createContext<ThreadPresentation>(DEFAULT);

/** @internal The thread's presentation options, for its rows. */
export function useThreadPresentation(): ThreadPresentation {
  return useContext(ThreadPresentationContext);
}
