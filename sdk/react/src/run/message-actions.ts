// A host's own actions on a message: what the host is told about the
// message, and the data form of each action, in the words of the kit's
// existing data act (`DetailAction`). The kit draws them (MessageActionBar),
// so their look, their keyboard access and the row they sit in stay the
// kit's; a host that draws its own bubble receives the same data.

import type { DetailAction } from "../resource-detail/types.js";

/**
 * What a host is told about a message it may act on.
 *
 * @example
 * ```tsx
 * import type { MessageAction, MessageInfo } from "@stigmer/react-sdk";
 *
 * function actionsFor(message: MessageInfo): readonly MessageAction[] {
 *   if (!message.isFinalAnswer) return [];
 *   return [{ id: "save", label: "Save to notes", onAction: () => saveNote(message.sessionId, message.text) }];
 * }
 *
 * declare function saveNote(sessionId: string, text: string): void;
 * ```
 */
export interface MessageInfo {
  /** The message's id in the session's log. */
  readonly id: string;
  /** Whose message it is: a person's or the agent's. */
  readonly role: "user" | "agent";
  /** The message's text as the log records it. */
  readonly text: string;
  /**
   * Whether it is its turn's final answer: the message a finished turn
   * closed on. False while the turn works, for a turn that stopped, failed
   * or ended on a step, for a turn Stigmer stopped, for a completed Plan
   * turn's plan, and for every person's message.
   */
  readonly isFinalAnswer: boolean;
  /** The session the message belongs to; `""` where the thread was not told it. */
  readonly sessionId: string;
  /** The turn's run. */
  readonly runId: string;
}

/**
 * One action a host adds to a message. Up to two with an `icon` draw as
 * quiet icon buttons beside Copy, named by their `label`; every other
 * action sits, in order, in one "More actions" menu. No key shortcut: a
 * message's actions never take a key from the page. The `id` names the act,
 * so it is unique among one message's actions; the `label` is its accessible
 * name, never blank.
 */
export type MessageAction = Pick<DetailAction, "id" | "label" | "icon" | "onAction" | "disabled" | "variant">;
