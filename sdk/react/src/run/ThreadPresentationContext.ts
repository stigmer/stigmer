// How a thread's rows are presented beyond their own data: what closes an
// ended turn, which asks the thread answers in a card of their own, the
// session the thread shows, and the host's actions on its messages.
// MessageThread provides it from its props and its items, so the options
// reach the rows of both the plain and the virtualized list without
// threading through either (the pattern of FilePathContext and
// FileReviewContext beside it).

import { createContext, useContext, type ReactNode } from "react";
import type { Turn, TurnEnding, TurnEndingNames, TurnEndingViewer } from "@stigmer/client";
import type { RunErrorNoticeLink } from "./RunErrorNotice.js";
import type { MessageAction, MessageInfo } from "./message-actions.js";

/** The act a turn's ending offers this viewer: its words and what it does. */
export interface TurnEndingAction {
  readonly label: string;
  readonly run: () => void;
}

/**
 * How an ended turn's notice is wired, from the host: who reads it, the
 * names its model resolves to, and the act and the link this viewer is
 * offered. Without it, a notice reads to a viewer who can act and fix
 * nothing, and its act re-sends through `onRetryRun`.
 */
export interface TurnEndingWiring {
  readonly viewer: TurnEndingViewer;
  /** The provider's and the model's display names for a model id. */
  readonly names?: (model: string) => TurnEndingNames;
  /** The act for this ending, or undefined for none. */
  readonly actOf?: (ending: TurnEnding, turn: Turn) => TurnEndingAction | undefined;
  /** The link to the fix for this ending, or undefined for none. */
  readonly linkOf?: (ending: TurnEnding, turn: Turn) => RunErrorNoticeLink | undefined;
  /** An act is in flight. */
  readonly acting?: boolean;
}

/** What MessageThread hands its rows. */
export interface ThreadPresentation {
  /** What closes an ended turn; undefined renders nothing there. */
  readonly turnOutcome?: (turn: Turn) => ReactNode;
  /** How an ended turn's notice is wired. */
  readonly turnEnding?: TurnEndingWiring;
  /**
   * The tool-use ids whose ask the thread draws as its own card (the
   * `approval-request` items): a row for one of them says it waits and
   * offers no decision, and a plan leaves it out, so the decision is drawn
   * once. Absent, none is: every row offers its own.
   */
  readonly cardedAsks?: ReadonlySet<string>;
  /** The session the thread shows, for host cards and message actions; absent, `""`. */
  readonly sessionId?: string;
  /** The host's actions for a message (`MessageThreadProps.messageActions`). */
  readonly messageActions?: (message: MessageInfo) => readonly MessageAction[];
}

const DEFAULT: ThreadPresentation = {};

/** @internal Provided by MessageThread. */
export const ThreadPresentationContext = createContext<ThreadPresentation>(DEFAULT);

/** @internal The thread's presentation options, for its rows. */
export function useThreadPresentation(): ThreadPresentation {
  return useContext(ThreadPresentationContext);
}
