/*
 * The spike's script vocabulary over the mock: each scenario owns a marker,
 * and a request belongs to the scenario whose marker appears in its
 * conversation's user text. A scenario answers from where the conversation
 * stands (which tool results its last message carries), so a resumed session
 * replaying its history is answered exactly as the first process was.
 *
 * Throwaway, like everything under `__spike__`.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  anthropicText,
  anthropicToolUses,
  type AnthropicMessageBody,
  type Conversation,
  type Script,
  type ToolUseBlock,
} from "./harness.js";
import type { TokenUsageOptions } from "../../../../../../test/support/src/llm-wire.ts";

/** One step a scenario answers with: what the model says at this point of the conversation. */
export type Step = (c: Conversation) => AnthropicMessageBody | undefined;

export interface Scenario {
  marker: string;
  answer: Step;
}

/** The script that routes each request to the scenario whose marker its user text carries. */
export function scenarios(list: readonly Scenario[]): Script {
  return (c) => {
    // A conversation belongs to the scenario whose marker its FIRST user
    // message carries: a sub-agent's opens with its own prompt, its parent's
    // with the parent's, and a later message (a background agent's
    // notification quoting the child's prompt) never moves it.
    const first = c.allUserTexts[0] ?? "";
    const owner = [...list].reverse().find((s) => first.includes(s.marker));
    return owner?.answer(c);
  };
}

/** The result for `id` in the conversation's last message (the point a scenario answers from). */
export function resultFor(c: Conversation, id: string): { text: string; isError: boolean } | undefined {
  return c.lastToolResults.find((r) => r.toolUseId === id);
}

/** The name the engine gives its sub-agent tool in this request's tool list. */
export function agentToolName(c: Conversation): string {
  return c.toolNames.includes("Agent") ? "Agent" : c.toolNames.includes("Task") ? "Task" : "Agent";
}

/**
 * The commonest shape: one tool call, then a final text quoting what the
 * tool returned, so the evidence shows what the model was told. A call
 * already in the history is never issued again; any other point of the
 * conversation (a prompt sent with a resume, a result that never came) is
 * answered as text saying what the model was handed.
 */
export function oneCall(marker: string, call: ToolUseBlock, finalText: string, usage: { first?: number; last?: number } = {}): Scenario {
  return {
    marker,
    answer: (c) => {
      const result = resultFor(c, call.toolCallId);
      if (result !== undefined) {
        return anthropicText(`${finalText} [tool said${result.isError ? " (error)" : ""}: ${result.text.slice(0, 300)}]`, {
          inputTokens: usage.last ?? 10,
          outputTokens: 5,
        });
      }
      if (!c.issuedToolUseIds.has(call.toolCallId) && c.lastToolResults.length === 0 && c.lastUserTexts.some((t) => t.includes(marker))) {
        return anthropicToolUses([call], { inputTokens: usage.first ?? 10, outputTokens: 5 });
      }
      return anthropicText(
        `${finalText} [unexpected point: issued=${c.issuedToolUseIds.has(call.toolCallId)} lastUser=${JSON.stringify(c.lastUserTexts.map((t) => t.slice(0, 120))).slice(0, 300)} results=${JSON.stringify(c.lastToolResults).slice(0, 300)}]`,
      );
    },
  };
}

/**
 * A parent that delegates to a sub-agent through the engine's Agent tool,
 * in the foreground (`run_in_background: false`) or the background (the
 * engine's default in 2.1.310, where the call returns at once and a
 * notification arrives when the agent finishes).
 */
export function delegate(
  marker: string,
  agentCallId: string,
  childPrompt: string,
  doneText: string,
  options: { background?: boolean; usage?: { start?: TokenUsageOptions; launched?: TokenUsageOptions; done?: TokenUsageOptions } } = {},
): Scenario {
  return {
    marker,
    answer: (c) => {
      const result = resultFor(c, agentCallId);
      if (result !== undefined && /async agent launched/i.test(result.text)) {
        return anthropicText(`${marker} waiting for the background agent`, options.usage?.launched);
      }
      if (result !== undefined) return anthropicText(`${doneText} [agent said: ${result.text.slice(0, 200)}]`, options.usage?.done);
      const notified = c.lastUserTexts.find((t) => /task-notification|SYSTEM NOTIFICATION/i.test(t));
      if (notified !== undefined && c.issuedToolUseIds.has(agentCallId)) {
        return anthropicText(`${doneText} [notified: ${notified.slice(0, 200)}]`, options.usage?.done);
      }
      if (!c.issuedToolUseIds.has(agentCallId) && c.lastUserTexts.some((t) => t.includes(marker))) {
        return anthropicToolUses(
          [
            {
              toolCallId: agentCallId,
              toolName: agentToolName(c),
              toolInput: {
                description: "probe sub-agent",
                prompt: childPrompt,
                subagent_type: "general-purpose",
                run_in_background: options.background ?? false,
              },
            },
          ],
          options.usage?.start,
        );
      }
      return anthropicText(`${marker} unexpected point: lastUser=${JSON.stringify(c.lastUserTexts.map((t) => t.slice(0, 120))).slice(0, 300)}`);
    },
  };
}

/** A batch: several calls in one assistant message; each later id answered by `onResults`. */
export function batch(marker: string, calls: readonly ToolUseBlock[], onResults: Step): Scenario {
  return {
    marker,
    answer: (c) => {
      if (c.lastToolResults.length === 0 && c.lastUserTexts.some((t) => t.includes(marker))) {
        return anthropicToolUses([...calls]);
      }
      return onResults(c);
    },
  };
}

/** The stdio probe MCP server, as a stdio config the engine starts. */
export function probeMcpServer(env: Record<string, string>, extra: Partial<McpStdioServerConfig> = {}): McpStdioServerConfig {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    type: "stdio",
    command: process.execPath,
    args: [join(here, "probe-mcp-server.mjs")],
    env,
    ...extra,
  };
}

/**
 * Masks a credential-shaped value before it is written to evidence: the
 * name and the value's length and first characters survive, enough to show
 * which secret was reachable, never the secret.
 */
export function maskEnv(env: Record<string, string | undefined>, secrets: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const credentialName = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|HEADERS/i.test(name);
    const carriesSecret = secrets.some((s) => s.length > 0 && value.includes(s));
    out[name] = credentialName || carriesSecret ? `<masked len=${value.length}${carriesSecret ? " CARRIES-A-PROBE-SECRET" : ""}>` : value;
  }
  return out;
}
