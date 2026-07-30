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
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export function createThinkTool() {
  return tool(
    async (_input: { thought: string }) => "ok",
    {
      name: "think",
      description:
        "Use this tool to think through a problem step-by-step. " +
        "The think tool does not read files, execute commands, or make any changes — " +
        "it simply records your reasoning. Call it when you need to pause and work " +
        "something out before acting.\n\n" +
        "Good times to use think:\n" +
        "- After reading files or tool output, to analyse what you learned\n" +
        "- Before a complex or multi-step operation, to plan your approach\n" +
        "- When you need to choose between several possible strategies\n" +
        "- When debugging — to reason about what might have gone wrong\n\n" +
        "You do NOT need to use think for every step — only when genuine " +
        "reasoning will improve the quality of your next action.",
      schema: z.object({
        thought: z.string().describe("Your reasoning, analysis, or plan."),
      }),
    },
  );
}
