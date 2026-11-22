/**
 * The host app's own tools as the Stigmer harness binds them: one LangChain
 * tool per tool the turn offers its main agent (`shared/custom-tools.ts`),
 * under its declared name, description and schema.
 *
 * A tool's body runs only on the resume after the host answered: the
 * custom-tool middleware paused the call before it (`middleware/custom-tools.ts`)
 * and the resume carries no verdict, only the fact that the host answered
 * (`hitl.ts`). The body hands the model the host's answer
 * (`TurnInput.customToolResults`): its text as the result, or, when the host
 * said the tool failed, as an error message. An error is returned, never
 * thrown: a thrown error reaches the error hints, which would append
 * recovery hints meant for the engine's own tools to the host's words.
 */

import { ToolMessage } from "@langchain/core/messages";
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";

import type { CustomToolAnswer } from "../../harness/custom-tool-answers.js";
import type { CustomToolOffer } from "../../shared/custom-tools.js";

/** What a body answers a call the host never answered: it is reached only past the pause, so only by a defect. */
export const NO_HOST_ANSWER_MESSAGE = "The app gave no answer to this call; it was not run.";

/** The tools for `offers`, each answering from `answers` (the header). */
export function createCustomTools(offers: readonly CustomToolOffer[], answers: ReadonlyMap<string, CustomToolAnswer>): DynamicStructuredTool[] {
  return offers.map(
    (offer) =>
      tool(
        async (_input: Record<string, unknown>, config: { readonly toolCall?: { readonly id?: string } }) => {
          const id = config.toolCall?.id ?? "";
          const answer = answers.get(id);
          if (answer === undefined) return new ToolMessage({ content: NO_HOST_ANSWER_MESSAGE, tool_call_id: id, name: offer.name, status: "error" });
          if (answer.isError) return new ToolMessage({ content: answer.text, tool_call_id: id, name: offer.name, status: "error" });
          return answer.text;
        },
        { name: offer.name, description: offer.description, schema: offer.inputSchema },
      ) as unknown as DynamicStructuredTool,
  );
}
