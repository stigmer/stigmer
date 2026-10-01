/**
 * The one way a middleware advises the model: a user-role message placed
 * after the latest messages of a single model request, never written to the
 * graph's state.
 *
 * Why this shape, and not the two it replaces (stigmer/stigmer#1354):
 *
 * - Not a mid-conversation system message. `@langchain/anthropic` refuses any
 *   system message that is not the first ("System messages are only
 *   permitted as the first passed message"), so every Anthropic run that
 *   reached an advisory failed its next model call. Saved into state from
 *   `afterModel`, it also sat between a tool call and its result, and the
 *   session's checkpoint replayed it into every later turn.
 * - Not a block on the system prompt. The system prompt is the session's,
 *   byte-stable from turn to turn and carrying the prompt-cache breakpoint
 *   (the request-shape conformance facet pins it); changing it re-writes the
 *   provider's cache for the whole conversation, at exactly the moment a cost
 *   advisory fires. Per-turn content rides user-role messages here, the rule
 *   `shared/conversation-catchup.ts` states for the catch-up digest.
 *
 * A user-role message after the tool results is the one shape both providers
 * accept: OpenAI takes a user message after its tool messages, and Anthropic
 * combines it with the tool-result turn ("consecutive user turns are combined
 * into a single turn"; text follows the `tool_result` blocks, as its tool-use
 * rules require). The fixed lead-in tells the model the words are the
 * platform's, not the user's.
 *
 * Lifetime: one model call. The advisory is in the request a middleware
 * hands its handler and nowhere else, so the checkpoint, the transcript and
 * every later turn see the conversation exactly as the user and the model had
 * it. A stale "8 of 10 tool rounds used" never reaches a later turn.
 *
 * What it costs: the system prompt's cache breakpoint is untouched, but the
 * conversation-tail breakpoint (deepagents' Anthropic prompt-caching
 * middleware runs inside this stack, and the client marks the last message)
 * lands on the advisory. The advised call therefore writes a cache entry no
 * later request extends, and the next call reads its last round uncached:
 * one partial miss per advisory, where a system-prompt change would re-write
 * the whole conversation.
 */

import { HumanMessage } from "@langchain/core/messages";
import type { ModelCallRequest } from "./types.js";

/** How every advisory opens, so the model reads it as the platform speaking. */
export const ADVISORY_LEAD_IN =
  "Advisory from the platform running this agent (not a message from the user):";

/** The message one advisory text becomes. */
export function advisoryMessage(text: string): HumanMessage {
  return new HumanMessage({ content: `${ADVISORY_LEAD_IN}\n\n${text}` });
}

/**
 * The request with one advisory message per text after its last message. With
 * no texts it returns the request itself, so a call with nothing to say is
 * handed on untouched.
 */
export function withAdvisories(request: ModelCallRequest, texts: readonly string[]): ModelCallRequest {
  if (texts.length === 0) return request;
  return { ...request, messages: [...request.messages, ...texts.map(advisoryMessage)] };
}
