// How a thread's rows are presented beyond their own data: what closes an
// ended turn. MessageThread provides it from its props, so the options
// reach the rows of both the plain and the virtualized list without
// threading through either (the pattern of FilePathContext and
// FileReviewContext beside it).

import { createContext, useContext, type ReactNode } from "react";
import type { Turn } from "@stigmer/client";

/** What MessageThread hands its rows. */
export interface ThreadPresentation {
  /** What closes an ended turn; undefined renders nothing there. */
  readonly turnOutcome?: (turn: Turn) => ReactNode;
}

const DEFAULT: ThreadPresentation = {};

/** @internal Provided by MessageThread. */
export const ThreadPresentationContext = createContext<ThreadPresentation>(DEFAULT);

/** @internal The thread's presentation options, for its rows. */
export function useThreadPresentation(): ThreadPresentation {
  return useContext(ThreadPresentationContext);
}
