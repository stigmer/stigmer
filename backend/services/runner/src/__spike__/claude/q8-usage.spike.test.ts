/*
 * Spike probe: is the engine's token usage countable per model call?
 *
 * Every scripted response carries distinct usage numbers. Per-call usage is
 * taken from the last assistant message of each `message.id` (several share
 * an id while a response streams) and checked three ways:
 *  - it equals what the mock answered, call by call, sub-agents included;
 *  - every request the mock received with no assistant message is listed with
 *    its tokens: spend the platform's proxy meters and the run's cost cap
 *    would never see from the stream;
 *  - a resumed turn reports only its own calls, while the result's
 *    `modelUsage` is cumulative.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  anthropicText,
  anthropicToolUses,
  baseOptions,
  runResume,
  evidencePath,
  freshDirs,
  gateHooks,
  recordingCanUseTool,
  resultSummary,
  runQuery,
  startSpikeMock,
  toolId,
  writeEvidence,
} from "./harness.js";
import { agentToolName, resultFor, scenarios } from "./scripts.js";

const TIMEOUT = 240_000;

interface CallUsage {
  messageId: string;
  parentToolUseId: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Usage per model call. The assistant messages carry the usage snapshot of
 * `message_start` (output always 0), so the final numbers are read from the
 * partial stream: `message_start` opens a call with its input and cache
 * tokens, the next `message_delta` in the same scope (parent tool use) gives
 * its output tokens. The assistant messages are kept as a second reading.
 */
export function perCallUsage(messages: readonly SDKMessage[]): CallUsage[] {
  const byId = new Map<string, CallUsage>();
  const openByScope = new Map<string, string>();
  for (const m of messages) {
    if (m.type === "stream_event") {
      const scope = m.parent_tool_use_id ?? "root";
      const e = m.event;
      if (e.type === "message_start") {
        const u = e.message.usage;
        byId.set(e.message.id, {
          messageId: e.message.id,
          parentToolUseId: m.parent_tool_use_id,
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
        });
        openByScope.set(scope, e.message.id);
      } else if (e.type === "message_delta") {
        const id = openByScope.get(scope);
        const call = id === undefined ? undefined : byId.get(id);
        if (call !== undefined) call.output = e.usage.output_tokens;
      }
    } else if (m.type === "assistant" && !byId.has(m.message.id)) {
      const u = m.message.usage;
      byId.set(m.message.id, {
        messageId: m.message.id,
        parentToolUseId: m.parent_tool_use_id,
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      });
    }
  }
  return [...byId.values()];
}

/** Usage per message id as the assistant messages alone report it (for the record). */
function assistantMessageUsage(messages: readonly SDKMessage[]): Array<{ id: string; input: number; output: number }> {
  return messages.flatMap((m) => (m.type === "assistant" ? [{ id: m.message.id, input: m.message.usage.input_tokens, output: m.message.usage.output_tokens }] : []));
}

interface Answered {
  kind: string;
  model: string;
  answered: { id?: string; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | string;
}

function answeredRequests(label: string): Answered[] {
  return readFileSync(evidencePath(`${label}.requests.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Answered);
}

describe("q8: usage per model call", () => {
  for (const forward of [false, true]) {
  it(`reconciles every call's usage with what the mock answered, sub-agents included (forwardSubagentText ${forward})`, async () => {
    const label = `q8${forward ? "-forward" : ""}`;
    const BASH = toolId(`q8_bash_${forward}`);
    const AGENT = toolId(`q8_agent_${forward}`);
    const dirs = freshDirs(label);
    const mock = await startSpikeMock(
      label,
      scenarios([
        {
          marker: "Q8-PARENT",
          answer: (c) => {
            if (resultFor(c, AGENT) !== undefined) return anthropicText("Q8 parent done", { inputTokens: 1003, outputTokens: 13, cacheReadInputTokens: 103 });
            if (resultFor(c, BASH) !== undefined) {
              return anthropicToolUses(
                [{ toolCallId: AGENT, toolName: agentToolName(c), toolInput: { description: "count", prompt: "Q8-CHILD answer", subagent_type: "general-purpose", run_in_background: false } }],
                { inputTokens: 1002, outputTokens: 12, cacheReadInputTokens: 102 },
              );
            }
            return anthropicToolUses([{ toolCallId: BASH, toolName: "Bash", toolInput: { command: "echo usage", description: "print" } }], {
              inputTokens: 1001,
              outputTokens: 11,
              cacheReadInputTokens: 101,
              cacheCreationInputTokens: 51,
            });
          },
        },
        { marker: "Q8-CHILD", answer: () => anthropicText("child answer", { inputTokens: 2001, outputTokens: 21 }) },
      ]),
    );
    try {
      const run = await runQuery(label, "Q8-PARENT go", {
        ...baseOptions(dirs, mock.url),
        includePartialMessages: true,
        forwardSubagentText: forward,
        canUseTool: recordingCanUseTool(label, [], () => ({ allow: true })),
      });
      const calls = perCallUsage(run.messages);
      const answered = answeredRequests(label);
      const answeredIds = new Set(calls.map((c) => c.messageId));
      const unseen = answered.filter((a) => typeof a.answered === "string" || a.answered.id === undefined || !answeredIds.has(a.answered.id));
      const mismatches = calls.flatMap((c): Array<Record<string, unknown>> => {
        const a = answered.find((x) => typeof x.answered !== "string" && x.answered.id === c.messageId);
        if (a === undefined || typeof a.answered === "string") return [{ messageId: c.messageId, problem: "no answered request with this id" }];
        const u = a.answered.usage!;
        return u.input_tokens === c.input && u.output_tokens === c.output && (u.cache_read_input_tokens ?? 0) === c.cacheRead && (u.cache_creation_input_tokens ?? 0) === c.cacheWrite
          ? []
          : [{ messageId: c.messageId, stream: c, answered: u }];
      });
      const r = run.result;
      const facts = {
        result: resultSummary(run),
        perCall: calls,
        assistantMessageUsage: assistantMessageUsage(run.messages),
        taskNotifications: run.messages.filter((m) => m.type === "system" && (m as { subtype?: string }).subtype === "task_notification").map((m) => (m as { usage?: unknown }).usage),
        answered: answered.map((a) => ({ kind: a.kind, model: a.model, answered: a.answered })),
        requestsWithNoAssistantMessage: unseen,
        mismatches,
        resultUsage: r?.usage,
        resultModelUsage: r?.modelUsage,
        totalCostUsd: r?.total_cost_usd,
      };
      writeEvidence(`${label}.facts.json`, facts);
      expect.soft(mismatches, "per-call usage equals the scripted usage").toEqual([]);
      expect.soft(calls.some((c) => c.parentToolUseId === AGENT), "the sub-agent's call is on the stream").toBe(true);
    } finally {
      await mock.close();
    }
  }, TIMEOUT);
  }

  it("a resumed turn's assistant messages carry only its own calls; modelUsage is cumulative", async () => {
    const BASH = toolId("q8r_bash");
    const dirs = freshDirs("q8r");
    const proof = join(dirs.cwd, "p.txt");
    const mock = await startSpikeMock(
      "q8r",
      scenarios([
        {
          marker: "Q8R",
          answer: (c) =>
            resultFor(c, BASH) !== undefined
              ? anthropicText("Q8R done", { inputTokens: 3002, outputTokens: 32 })
              : anthropicToolUses([{ toolCallId: BASH, toolName: "Bash", toolInput: { command: `echo r > ${proof}`, description: "write" } }], {
                  inputTokens: 3001,
                  outputTokens: 31,
                }),
        },
      ]),
    );
    try {
      const turn1 = await runQuery("q8r.turn1", "Q8R go", {
        ...baseOptions(dirs, mock.url),
        hooks: gateHooks("q8r.turn1", (i) => (i.tool_name === "Bash" ? { decision: "defer" } : { decision: "pass" }), []),
        canUseTool: recordingCanUseTool("q8r.turn1", [], () => ({ allow: false, message: "no" })),
      });
      const turn2 = await runResume("q8r.turn2", {
        ...baseOptions(dirs, mock.url),
        resume: turn1.sessionId,
        hooks: gateHooks("q8r.turn2", (i) => (i.tool_name === "Bash" ? { decision: "allow" } : { decision: "pass" }), []),
        canUseTool: recordingCanUseTool("q8r.turn2", [], () => ({ allow: true })),
      });
      const facts = {
        turn1: { ...resultSummary(turn1), perCall: perCallUsage(turn1.messages), usage: turn1.result?.usage, modelUsage: turn1.result?.modelUsage },
        turn2: { ...resultSummary(turn2), perCall: perCallUsage(turn2.messages), usage: turn2.result?.usage, modelUsage: turn2.result?.modelUsage },
      };
      writeEvidence("q8r.facts.json", facts);
      expect.soft(facts.turn2.perCall.map((c) => c.input), "the resume's stream carries only its own call").toEqual([3002]);
    } finally {
      await mock.close();
    }
  }, TIMEOUT);
});
