/*
 * Spike, verification step 1: the side-call inventory. Three turns (text
 * only, one tool call, one sub-agent) against the mock, every request the
 * engine makes listed by path, model, system prompt opening and tool count.
 * A request no scenario owns is answered with a flagged text, never a 500,
 * so the inventory sees the engine's whole conversation, background calls
 * included. Each background call found gets a signature in `harness.ts`
 * `backgroundKind`, and the probes after this one run with it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anthropicText,
  baseOptions,
  backgroundKind,
  freshDirs,
  resultSummary,
  runQuery,
  startSpikeMock,
  toolId,
  writeEvidence,
  type SpikeMock,
} from "./harness.js";
import { delegate, oneCall, scenarios } from "./scripts.js";

const BASH = toolId("inv_bash");
const AGENT = toolId("inv_agent");
const AGENT_BG = toolId("inv_agent_bg");

const owned = scenarios([
  { marker: "INV-TEXT", answer: () => anthropicText("inventory text answer") },
  oneCall("INV-TOOL", { toolCallId: BASH, toolName: "Bash", toolInput: { command: "echo inventory", description: "print" } }, "inventory tool done"),
  delegate("INV-SUB-PARENT", AGENT, "INV-SUB-CHILD answer in one word", "inventory parent done"),
  delegate("INV-BG-PARENT", AGENT_BG, "INV-BG-CHILD answer in one word", "inventory background parent done", { background: true }),
  { marker: "INV-SUB-CHILD", answer: () => anthropicText("child-word") },
  { marker: "INV-BG-CHILD", answer: () => anthropicText("background-child-word") },
]);

describe("inventory: every request the engine makes", () => {
  let mock: SpikeMock;
  beforeAll(async () => {
    mock = await startSpikeMock("inventory", (c) => owned(c) ?? anthropicText(`UNOWNED-REQUEST fallback (${c.model})`));
  });
  afterAll(async () => {
    await mock.close();
  });

  it("lists the requests of a text turn, a tool turn and a sub-agent turn", async () => {
    const summary: Record<string, unknown> = {};
    for (const [label, prompt] of [
      ["text", "INV-TEXT say hello"],
      ["tool", "INV-TOOL run the command"],
      ["subagent", "INV-SUB-PARENT delegate this"],
      ["subagent-background", "INV-BG-PARENT delegate this"],
    ] as const) {
      const before = mock.conversations().length;
      const dirs = freshDirs(`inv-${label}`);
      const run = await runQuery(
        `inventory-${label}`,
        prompt,
        baseOptions(dirs, mock.url, {
          canUseTool: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
        }),
      );
      const requests = mock.conversations().slice(before);
      summary[label] = {
        result: resultSummary(run),
        requests: requests.map((c) => ({
          path: c.path,
          model: c.model,
          background: backgroundKind(c) ?? null,
          owned: owned(c) !== undefined,
          system: c.system.slice(0, 160),
          tools: c.toolNames.length,
          toolNames: c.toolNames,
          messages: c.messageCount,
          firstUser: (c.allUserTexts[0] ?? "").slice(0, 200),
          headerNames: Object.keys(c.headers).sort(),
          stream: c.raw.stream,
          toolChoice: c.raw.tool_choice ?? null,
          bodyKeys: Object.keys(c.raw).sort(),
        })),
      };
    }
    writeEvidence("inventory.summary.json", summary);
    const unowned = Object.values(summary).flatMap((s) => (s as { requests: Array<{ owned: boolean; background: string | null }> }).requests.filter((r) => !r.owned && r.background === null));
    writeEvidence("inventory.unowned.json", unowned);
    // The inventory passes when it ran; what it found is read, not asserted.
    expect(Object.keys(summary)).toHaveLength(4);
  }, 600_000);
});
