/**
 * The native engine's delivery of the messages a person sends while its
 * turn works (`harness/turn-input.ts`): read at the next step, as a user
 * message after the step's tool results, inside the same turn.
 *
 *   - Before each model call (`beforeModel`), the turn takes what the
 *     session's queue holds for it (`TurnSink.input.claim`, forced: the
 *     runtime's hint is as fresh as the turn's last status write, and a
 *     tool that works silently for ten minutes writes none, so the hint
 *     would leave a message sent meanwhile for the round's end; the call
 *     is cheap when nothing waits) and appends each
 *     message to the thread as a `HumanMessage`, after the latest tool
 *     results: the model reads it in this call. A user message after tool
 *     results is the shape both providers accept, and `@langchain/anthropic`
 *     keeps it its own user turn (the advisory's reasoning,
 *     `middleware/advisory-message.ts`).
 *   - When the model answers with no tool call, the round's end
 *     (`afterModel`), the turn asks once more, whatever the hint says, and
 *     goes back to the model with what it took: a message sent as the turn
 *     finished is read by it, never left for a next turn.
 *   - An invocation's first call, and every round's end, also delivers
 *     what the run took and the thread does not hold
 *     (`TurnSink.input.claimed`): a claim whose answer was lost, or one a
 *     stopped invocation took before its save. A new turn holds none, and
 *     the read finds its own message alone.
 *
 * Unlike an advisory, a message is the person's: it is written to the
 * thread's state, so every later call, the checkpoint and a continuation
 * see it, and the ids delivered are kept beside it under
 * {@link DELIVERED_INPUTS_KEY}, the way the run stamp is (`run-stamp.ts`):
 * the save that holds the message holds its id, so a message is delivered
 * once. The root graph only: a sub-agent never reads the person's message.
 * Nothing is taken once the runtime's stop or yield fired; what waits is
 * the next invocation's, or the next turn's.
 *
 * Before each take, the middleware crosses a barrier (`input-barrier.ts`):
 * the stream loop has folded what the graph produced before it, and the
 * claim's write puts that in the log first, so a message sits in the log
 * after the answer or tool results the agent wrote before reading it.
 *
 * The message's text is composed as the turn's own (`prompt-builder.ts`
 * `composeUserMessage`): its files listed first, its images inline.
 *
 * Proven by __tests__/turn-input-middleware.test.ts and the harness
 * contract kit's message arms.
 */

import { HumanMessage, isAIMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { z } from "zod";

import type { TurnInputChannel, TurnMessage } from "../../harness/turn-input.js";
import { toLangChainImageBlocks } from "../../shared/attachment-vision.js";
import { visionPromptInfoOf } from "../../shared/prompt-sections.js";
import { customStreamWriterOf } from "../../middleware/tool-scope.js";
import type { InputBarriers } from "./input-barrier.js";
import { composeUserMessage } from "./prompt-builder.js";

/** The state key the delivered message ids live under. Thread state: renaming it re-delivers every saved message. */
export const DELIVERED_INPUTS_KEY = "stigmerDeliveredInputs";

/** What the middleware reads its messages from. */
export interface TurnInputDelivery {
  readonly input: TurnInputChannel;
  /** Whether the runtime's stop or yield fired: nothing more is taken. */
  readonly stopped: () => boolean;
  /** Crossed before each take (`input-barrier.ts`); none takes at once. */
  readonly barriers?: InputBarriers;
}

/** The ids of the messages the thread holds, as its latest save recorded them. */
export function deliveredInputsOf(values: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const ids = values[DELIVERED_INPUTS_KEY];
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

/** A message as the model reads it: its files listed, its images inline, its text. */
export function humanMessageOf(message: TurnMessage): HumanMessage {
  const text = composeUserMessage({
    message: message.text,
    inputFiles: { message: message.message, conversation: [], references: [] },
    vision: visionPromptInfoOf(message),
    workspaceFileRefs: [],
  });
  return new HumanMessage({
    id: message.id,
    content:
      message.visionImages.length > 0 ? [...toLangChainImageBlocks(message.visionImages), { type: "text", text }] : text,
  });
}

/**
 * The state update that delivers `messages`: each the thread does not
 * already hold, once, in the order given; undefined when none is new.
 */
export function deliveryOf(
  values: Readonly<Record<string, unknown>>,
  messages: readonly TurnMessage[],
): { readonly messages: BaseMessage[]; readonly [DELIVERED_INPUTS_KEY]: string[] } | undefined {
  const delivered = deliveredInputsOf(values);
  const fresh = new Map<string, TurnMessage>();
  for (const message of messages) {
    if (!delivered.has(message.id) && !fresh.has(message.id)) fresh.set(message.id, message);
  }
  if (fresh.size === 0) return undefined;
  return {
    messages: [...fresh.values()].map(humanMessageOf),
    [DELIVERED_INPUTS_KEY]: [...delivered, ...fresh.keys()],
  };
}

/** The middleware (module header). */
export function createTurnInputMiddleware(delivery: TurnInputDelivery) {
  let owedRead = false;
  return createMiddleware({
    name: "StigmerTurnInput",
    stateSchema: z.object({ [DELIVERED_INPUTS_KEY]: z.array(z.string()).optional() }),
    beforeModel: async (state, runtime) => {
      if (delivery.stopped()) return undefined;
      const owed = owedRead ? [] : await delivery.input.claimed(deliveredInputsOf(state));
      owedRead = true;
      await delivery.barriers?.cross(customStreamWriterOf(runtime));
      return deliveryOf(state, [...owed, ...(await delivery.input.claim({ force: true }))]);
    },
    afterModel: {
      canJumpTo: ["model"],
      hook: async (state, runtime) => {
        const last = state.messages.at(-1);
        if (delivery.stopped() || last === undefined || !isAIMessage(last) || (last.tool_calls?.length ?? 0) > 0) {
          return undefined;
        }
        await delivery.barriers?.cross(customStreamWriterOf(runtime));
        await delivery.input.claim({ force: true });
        const update = deliveryOf(state, await delivery.input.claimed(deliveredInputsOf(state)));
        return update === undefined ? undefined : { ...update, jumpTo: "model" };
      },
    },
  });
}
