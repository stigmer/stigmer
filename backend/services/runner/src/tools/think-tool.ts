/**
 * Think tool for structured agent reasoning.
 *
 * A no-op tool that gives LLMs a dedicated place to reason before acting.
 * The thought is captured as a regular tool-call argument, making it
 * observable through the existing status pipeline (StatusBuilder, gRPC
 * updates, CLI rendering) without any special handling.
 *
 * Follows the Anthropic "think tool" pattern:
 * https://www.anthropic.com/engineering/claude-think-tool
 *
 * The description says when a call is worth it, because every call is a
 * model round of its own: the whole prompt re-sent for a thought. The
 * earlier text suggested one "after reading files or tool output", and the
 * benchmark's per-call record showed think rounds right after reads and
 * right before the reply. Whether the tool is bound at all is the thinking
 * mode's question, not this module's.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export function createThinkTool() {
  return tool(
    async (_input: { thought: string }) => "ok",
    {
      name: "think",
      description:
        "Record your reasoning when a decision is genuinely hard: choosing between approaches, " +
        "or working out why something failed. It reads nothing and changes nothing. Do not use it " +
        "to restate a tool result or to announce your next step; take the step.",
      schema: z.object({
        thought: z.string().describe("Your reasoning, analysis, or plan."),
      }),
    },
  );
}
