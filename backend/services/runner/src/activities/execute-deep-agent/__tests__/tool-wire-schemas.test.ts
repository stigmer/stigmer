/**
 * The wire contract of the tools the runner builds itself: the JSON Schema
 * each one sends to a model, recorded as a file snapshot so a dependency
 * upgrade (zod, @langchain/core's serializer) cannot change what a model is
 * asked to fill without a reviewed diff.
 *
 * Every tool goes through `convertToOpenAITool`, whose `parameters` come
 * from `@langchain/core`'s `toJsonSchema`, the serializer both provider
 * bindings call (`@langchain/anthropic` reads the same `toJsonSchema` for its
 * `input_schema`). The shell tool is recorded as the model sees it: the
 * declaration the tool-intent middleware swaps in, with the `description`
 * argument added (`middleware/tool-intent.ts`).
 *
 * Tools built by deepagents, langchain or an MCP server are theirs and are
 * not recorded here.
 *
 * Regenerate ONLY after a deliberate change to what the runner's tools send:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/tool-wire-schemas.test.ts -u
 */

import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createShellTool, createStopBackgroundCommandTool, type ShellRunner } from "../shell-tool.js";
import { createWebFetchTool } from "../../../tools/web-fetch-tool.js";
import { createToolIntentMiddleware } from "../../../middleware/tool-intent.js";
import { BackgroundCommands } from "../../../shared/shell/background-commands.js";

const NEVER_RUNS: ShellRunner = {
  async runShell() {
    throw new Error("the wire-schema test never runs a command");
  },
};

/** The tool list after the tool-intent middleware, as the model call receives it. */
async function asModelSees(tools: readonly unknown[]): Promise<readonly unknown[]> {
  let seen: readonly unknown[] = [];
  await createToolIntentMiddleware().wrapModelCall!(
    { model: {}, messages: [], tools, state: {}, runtime: {} } as never,
    (async (request: { tools?: unknown[] }) => {
      seen = request.tools ?? [];
      return new AIMessage({ content: "" });
    }) as never,
  );
  return seen;
}

describe("the runner's own tools on the wire", () => {
  it("each tool's definition matches its recorded JSON Schema", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const built = [
      createShellTool({ backend: NEVER_RUNS, maxTimeoutSeconds: 600, floorMs: 0 }),
      createStopBackgroundCommandTool(new BackgroundCommands()),
      createWebFetchTool({ posture: "strict" }),
    ];

    // ── Act ──────────────────────────────────────────────────────────────────
    const seen = await asModelSees(built);
    const definitions = seen.map((t) => convertToOpenAITool(t as StructuredToolInterface));

    // ── Assert ───────────────────────────────────────────────────────────────
    expect(definitions.map((d) => d.function.name)).toEqual(["execute", "stop_background_command", "web_fetch"]);
    await expect(JSON.stringify(definitions, null, 2) + "\n").toMatchFileSnapshot("./goldens/tool-wire-schemas.json");
  });
});
