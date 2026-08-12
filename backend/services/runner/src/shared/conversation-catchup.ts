/**
 * Conversation catchup (cloud channel-conversations DD-006): what happened on
 * a live channel conversation that the agent has not seen — customer messages
 * handled by a human teammate, the teammate's replies, platform notices,
 * notes, and the agent's own earlier escalations. Since cloud#347 a line
 * whose send is known-undelivered carries a `(not delivered)` speaker
 * annotation and an in-flight one carries `(sending)` — the digest no longer
 * implies every public-lane line reached the customer.
 *
 * The cloud composes the CONTENT (bare `Customer:` / `Teammate:` / `System:` /
 * `You escalated:` / `Note:` lines, oldest first) on the execution spec's
 * `conversation_catchup` field, fresh per turn. This module owns the
 * PRESENTATION framing; the digest is prepended to the TURN'S USER MESSAGE on
 * both harnesses (A27) — never the system prompt — because it is per-turn
 * conversation content that must persist in the conversation history: the
 * native system prompt is rebuilt per invocation and would forget the digest
 * one turn later, while a message rides the checkpointer/agent store forever.
 *
 * Unlike its metadata-keyed siblings (context-bridge, sender-identity,
 * session-context) there is no string key to mirror-guard: the value rides a
 * TYPED proto field, so codegen enforces the cross-repo contract. The
 * degradation posture still holds — an absent or blank digest renders
 * nothing, and a runner predating this module simply ignores the field: the
 * agent re-enters blind, exactly the pre-DD-006 behavior, never worse.
 */

import type { ConversationCatchup } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";

/**
 * How the digest is introduced to the model, shared by both harnesses so the
 * behavioral contract ("known history, don't answer or announce it") cannot
 * drift between them. Deliberately takeover-neutral: a digest can exist with
 * no human handoff at all (a failed turn's re-composed window), so the
 * preamble asserts only what is always true (the A15/A20 honesty bar).
 *
 * The send-status annotations (cloud#347) get an explicit exception from the
 * don't-re-answer contract: a `(not delivered)` teammate reply is words the
 * customer never got, so treating it as settled history would silently
 * abandon whatever it was meant to convey. The preamble defines the
 * annotations — the DD-013 split puts model-facing meaning here, while the
 * cloud composer owns which lines earn them.
 */
const CONVERSATION_CATCHUP_PREAMBLE =
  "Below is activity from this conversation that you have not seen — " +
  "oldest first. It may include customer messages that were handled by a " +
  "human teammate, the teammate's own replies, notices sent to the " +
  "customer, internal notes, and escalations you raised earlier. Treat it " +
  "as conversation history you already know: do not answer or re-answer " +
  "these messages, do not repeat or summarize them back, and do not " +
  "mention any handoff unless asked. One exception: lines marked " +
  "(not delivered) never reached the customer, and lines marked (sending) " +
  "were still on their way when this summary was built — the customer may " +
  "not have seen those words, so weigh that when deciding what still needs " +
  "saying. Continue from the customer's newest message.";

/**
 * Read the catchup digest from an execution spec's `conversation_catchup`.
 * Returns undefined when the field is absent or the digest is blank — the
 * caller renders no section. The field itself is present on EVERY channel
 * turn (its `window_end` is cloud watermark bookkeeping this module must
 * never read); only a non-empty digest means there is something to say.
 */
export function readConversationCatchup(
  catchup: ConversationCatchup | undefined,
): string | undefined {
  const digest = catchup?.digest?.trim();
  return digest ? digest : undefined;
}

/** The framed catchup body (preamble + digest), ready for section wrapping. */
export function formatConversationCatchupText(digest: string): string {
  return `${CONVERSATION_CATCHUP_PREAMBLE}\n\n${digest.trim()}`;
}
