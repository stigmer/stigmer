"use client";

// What the conversation is doing, as the session view reports it to an
// <AgentChat> frame around it, so the popup's closed button can say it.
// Kept in its own small module, holding words rather than the turn: the
// frame imports it eagerly, while the session view that reports through it
// (and the turn derivation that finds the words) loads as a later chunk.

import { createContext } from "react";

/** The conversation's state, as the frame around it needs it. */
export type ChatActivity =
  | { readonly kind: "idle" }
  | {
      readonly kind: "working";
      /** What the turn is doing, in the working line's words ("Running a command"). */
      readonly phrase: string;
      /** Whether the turn waits on the person (a question or an approval). */
      readonly waiting: boolean;
      /** When the turn started, in epoch milliseconds, so the frame can count the time. */
      readonly startedAtMs: number;
    }
  | {
      readonly kind: "ended";
      /** The ended turn's run, which says whether the person has seen it. */
      readonly runId: string;
      /** The turn's ending phase ("completed", "failed", ...). */
      readonly phase: string;
      /** How many Files the turn returned. */
      readonly filesMade: number;
    };

/** Receives the conversation's activity; `null` outside an <AgentChat> frame. */
export const ChatActivityReporterContext = createContext<((activity: ChatActivity) => void) | null>(null);
