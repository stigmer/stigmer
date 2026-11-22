"use client";

// How a row reaches the answer to a call of the app's own tools, without
// reading the viewer: the thread puts the conversation's answer on this
// context, beside the approvals' (ApprovalContext), and a row takes the
// answer bound to its own call. The two stay apart, as on the wire: an
// answer here is content the agent reads, never a verdict.

import { createContext, useContext, useMemo, useRef } from "react";
import type { ToolUse } from "@stigmer/client";
import type { CustomToolAnswer } from "./tool-cards-context.js";

/**
 * Answers a call of the app's own tools by its id, with the session bound.
 * Rejects with the server's error.
 */
export type AnswerCustomToolUse = (customToolUseId: string, text: string, options?: { readonly isError?: boolean }) => Promise<void>;

/** @internal The thread's answer for the app's own tools; absent for a viewer who may not answer. */
export interface CustomToolAnswerContextValue {
  /** One stable answer per call id, built once and kept, or undefined when this viewer may not answer. */
  readonly answerFor: ((customToolUseId: string) => CustomToolAnswer) | undefined;
}

/** @internal */
export const CustomToolAnswerContext = createContext<CustomToolAnswerContextValue>({ answerFor: undefined });

/**
 * @internal One stable {@link CustomToolAnswer} per call id over `answer`,
 * so a card's memo and a host's stored callback keep one function for a
 * call across renders. Each binds the latest `answer` when called; the map
 * is dropped when `answer` comes and goes (a viewer that may no longer
 * answer). Undefined while `answer` is.
 */
export function useCustomToolAnswers(answer: AnswerCustomToolUse | undefined): ((customToolUseId: string) => CustomToolAnswer) | undefined {
  const latest = useRef(answer);
  latest.current = answer;
  const answers = answer !== undefined;
  return useMemo(() => {
    if (!answers) return undefined;
    const map = new Map<string, CustomToolAnswer>();
    return (id: string): CustomToolAnswer => {
      let fn = map.get(id);
      if (fn === undefined) {
        // The handler this viewer held when the answer was made: a host's
        // panel may outlive the chat, and the handler closes over the
        // client and the ids, not the component.
        const held = latest.current;
        fn = (text, options) => {
          const send = latest.current ?? held;
          return send === undefined ? Promise.resolve() : send(id, text, options);
        };
        map.set(id, fn);
      }
      return fn;
    };
  }, [answers]);
}

/**
 * @internal The answer a row gives a host's card: bound to the call while it
 * waits on the app and this viewer may answer; undefined otherwise.
 */
export function useCustomToolAnswer(toolUse: Pick<ToolUse, "id" | "state" | "custom">): CustomToolAnswer | undefined {
  const { answerFor } = useContext(CustomToolAnswerContext);
  if (answerFor === undefined || toolUse.custom !== true || toolUse.state !== "waiting_on_host") return undefined;
  return answerFor(toolUse.id);
}
