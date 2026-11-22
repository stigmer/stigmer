"use client";

// A host's own cards for its own tools: the public types a card is written
// against, and the context `StigmerProvider` hands the rows its map through.
// Kept apart from the rows' helpers (tool-card.ts), as the mermaid loader's
// context is, so the provider's entry carries the context and nothing else.

import { createContext, type ComponentType } from "react";
import type { JsonObject } from "@bufbuild/protobuf";

/**
 * How a tool call stands, as a host's card reads it. The kit's own set,
 * mapped from the session log's, so a new log state reaches a card only when
 * the kit maps it.
 *
 * - `running`: the tool works.
 * - `needs-approval`: a person must allow the call first; the decision is
 *   the kit's, drawn in the row (the card gets no way to answer it).
 * - `waiting-on-host`: a call of one of the app's own tools (the session's
 *   `custom_tools`), until the app answers it. The card's `answer` answers
 *   it, for a viewer who may.
 * - `completed`: the tool returned.
 * - `failed`: the tool returned an error, or its result says it failed.
 * - `denied`: a person said no; the tool never ran.
 * - `stopped`: the turn ended before the tool returned.
 */
export type ToolCallState = "running" | "needs-approval" | "waiting-on-host" | "completed" | "failed" | "denied" | "stopped";

/**
 * The narrowed view of one tool call a host's card receives: never the raw
 * log type, so the log can grow without breaking a card.
 */
export interface ToolCallInfo {
  /** The tool use's event id. */
  readonly id: string;
  /** The tool's bare name (`create_invoice`). */
  readonly tool: string;
  /** The connected server's slug (`billing`); `""` for a custom tool. */
  readonly server: string;
  /**
   * The call's input, whole, with secret-keyed values hidden. It is the
   * model's output: show it, and never act on it alone.
   */
  readonly input: JsonObject;
  /** How the call stands. */
  readonly state: ToolCallState;
  /**
   * What the tool returned, once it returned. `truncated` is true when the
   * log kept only the head of an output too large to store inline.
   */
  readonly result:
    | {
        readonly text: string;
        readonly isError: boolean;
        readonly truncated: boolean;
      }
    | undefined;
  /** The session the call belongs to; `""` where the thread was not told it. */
  readonly sessionId: string;
  /** The turn's run. */
  readonly runId: string;
}

/**
 * Answers one waiting call of the app's own tools, bound to its session and
 * call. The text is what the agent reads as the tool's result; `isError`
 * tells it the tool failed (a save that failed, or a person who cancelled),
 * so it can try again or say so.
 *
 * Resolves when the server recorded the answer; the row turns answered
 * when the result arrives on the stream. The same answer sent again
 * resolves; a different one rejects, since a call is answered once. It
 * stays callable after the chat unmounts, for a host's panel that
 * outlives it.
 */
export type CustomToolAnswer = (text: string, options?: { readonly isError?: boolean }) => Promise<void>;

/** Props a host's tool card receives. */
export interface ToolCardProps {
  /** The call to draw. */
  readonly call: ToolCallInfo;
  /**
   * Answers the call, while it waits on the app (`waiting-on-host`) and only
   * for a viewer who may answer it (the conversation's owner, as for an
   * approval). Undefined otherwise: a card drawn for someone only watching
   * shows the call and offers no answer.
   */
  readonly answer?: CustomToolAnswer;
}

/**
 * A host's own cards, keyed by a tool's public name: `mcp__<server>__<tool>`
 * for a connected server's tool, and the declared name for one of the app's
 * own tools (`toolPublicName` in `@stigmer/client`). Built-in tools stay the
 * kit's and take no card.
 *
 * Define each card at module level: the rows rely on `React.memo`, and a
 * component recreated on every render remounts its card.
 *
 * @example
 * ```tsx
 * import type { ToolCardProps, ToolCards } from "@stigmer/react-sdk";
 *
 * function InvoiceCard({ call }: ToolCardProps) {
 *   if (call.state === "running") return <p>Creating the invoice…</p>;
 *   if (call.result === undefined || call.result.isError) return <p>No invoice was made.</p>;
 *   return <p>Invoice ready: {call.result.text}</p>;
 * }
 *
 * export const toolCards: ToolCards = { mcp__billing__create_invoice: InvoiceCard };
 * ```
 */
export type ToolCards = Readonly<Record<string, ComponentType<ToolCardProps>>>;

/**
 * @internal The host's {@link ToolCards}, from `StigmerProvider`'s
 * `toolCards`; `null` when the host passed none.
 */
export const ToolCardsContext = createContext<ToolCards | null>(null);
