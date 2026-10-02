/**
 * Loop detection middleware for autonomous agents.
 *
 * Detects and prevents infinite loops by tracking tool invocations:
 *
 * wrapModelCall — after the model answers, inspects the response's
 *   tool_calls and tracks signatures (tool name + param hash) in a sliding
 *   window. When a repetitive pattern is detected, the intervention advises
 *   the model on its next call (`advisory-message.ts`): it rides that one
 *   request and never enters the graph's state. The response's tools run
 *   after this returns, so a stop decided here halts them below.
 *
 * wrapToolCall — when the total-repetition threshold has been exceeded,
 *   short-circuits tool execution with a ToolMessage halt notice.
 *
 * Until stigmer/stigmer#1354 the interventions were SystemMessages returned
 * from `afterModel`: saved into state between the model's tool calls and
 * their results, they failed the next Anthropic call and were replayed into
 * every later turn of the session from its checkpoint.
 */

import { createHash } from "node:crypto";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StigmerMiddleware, LoopDetectionConfig } from "./types.js";
import { withAdvisories } from "./advisory-message.js";

const DEFAULTS: LoopDetectionConfig = {
  historySize: 20,
  consecutiveThreshold: 7,
  totalThreshold: 20,
  enabled: true,
};

type Signature = readonly [name: string, hash: string];

function hashParams(params: Record<string, unknown>): string {
  try {
    const normalized = JSON.stringify(params, Object.keys(params).sort(), undefined);
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  } catch {
    return "error";
  }
}

function detectConsecutive(history: Signature[]): { isLoop: boolean; toolName: string; count: number } {
  if (history.length === 0) return { isLoop: false, toolName: "", count: 0 };

  const [recentName, recentHash] = history[history.length - 1];
  let count = 1;

  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i][0] === recentName && history[i][1] === recentHash) {
      count++;
    } else {
      break;
    }
  }

  return { isLoop: false, toolName: recentName, count };
}

function detectTotal(history: Signature[]): { isExcessive: boolean; toolName: string; count: number } {
  if (history.length === 0) return { isExcessive: false, toolName: "", count: 0 };

  const [recentName, recentHash] = history[history.length - 1];
  let count = 0;
  for (const [name, hash] of history) {
    if (name === recentName && hash === recentHash) count++;
  }

  return { isExcessive: false, toolName: recentName, count };
}

function buildIntervention(
  toolName: string,
  consecutiveCount: number,
  totalCount: number,
  isFinal: boolean,
): string {
  if (isFinal) {
    return (
      `\u26a0\ufe0f LOOP DETECTED: Critical repetition limit reached.\n\n` +
      `You have called '${toolName}' ${totalCount} times with similar parameters. ` +
      `This indicates you are stuck in a loop and unable to make progress.\n\n` +
      `**You MUST conclude your work now:**\n` +
      `1. Summarize what you have learned so far\n` +
      `2. Explain the obstacle preventing progress\n` +
      `3. Provide your best assessment based on available information\n` +
      `4. Do NOT call '${toolName}' again\n\n` +
      `Conclude gracefully with the information you have gathered.`
    );
  }

  return (
    `\u26a0\ufe0f LOOP WARNING: Repetitive pattern detected.\n\n` +
    `You have called '${toolName}' ${consecutiveCount} times in a row. ` +
    `This suggests you may be stuck or approaching the problem incorrectly.\n\n` +
    `**Recommended actions:**\n` +
    `1. Try a completely different approach or tool\n` +
    `2. Re-examine your assumptions about the problem\n` +
    `3. Consider if you have enough information to conclude\n` +
    `4. Avoid calling '${toolName}' again unless absolutely necessary\n\n` +
    `Adapt your strategy to make progress.`
  );
}

export function createLoopDetectionMiddleware(
  config: Partial<LoopDetectionConfig> = {},
): StigmerMiddleware {
  const cfg = { ...DEFAULTS, ...config };
  let history: Signature[] = [];
  let interventionCount = 0;
  let stopped = false;
  let pendingIntervention: string | null = null;

  /** Tracks one response's tool calls; returns the intervention it triggers, else null. */
  function inspect(response: unknown): string | null {
    if (!cfg.enabled || stopped) return null;
    if (!AIMessage.isInstance(response)) return null;
    const toolCalls = response.tool_calls ?? [];

    for (const tc of toolCalls) {
      const name = tc.name ?? "unknown";
      const args = tc.args ?? {};
      const paramHash = hashParams(args);

      history.push([name, paramHash]);
      if (history.length > cfg.historySize) {
        history = history.slice(-cfg.historySize);
      }

      const { toolName: consToolName, count: consCount } = detectConsecutive(history);
      const { toolName: totalToolName, count: totalCount } = detectTotal(history);

      if (totalCount >= cfg.totalThreshold) {
        interventionCount++;
        stopped = true;
        console.warn(
          `[LoopDetection] STOP: ${totalToolName} called ${totalCount} times (threshold: ${cfg.totalThreshold})`,
        );
        return buildIntervention(totalToolName, consCount, totalCount, true);
      }

      if (consCount >= cfg.consecutiveThreshold && interventionCount === 0) {
        interventionCount++;
        console.warn(
          `[LoopDetection] WARNING: ${consToolName} called ${consCount} times in a row (threshold: ${cfg.consecutiveThreshold})`,
        );
        return buildIntervention(consToolName, consCount, totalCount, false);
      }
    }
    return null;
  }

  return {
    name: "LoopDetectionMiddleware",

    beforeAgent() {
      history = [];
      interventionCount = 0;
      stopped = false;
      pendingIntervention = null;
    },

    async wrapModelCall(request, handler) {
      const advisories = pendingIntervention !== null ? [pendingIntervention] : [];
      pendingIntervention = null;
      const response = await handler(withAdvisories(request, advisories));
      const intervention = inspect(response);
      if (intervention !== null) pendingIntervention = intervention;
      return response;
    },

    async wrapToolCall(request, handler) {
      if (stopped) {
        return new ToolMessage({
          content:
            "[Loop detected: tool execution halted by loop detection middleware. " +
            "Conclude your work with the information you have gathered.]",
          tool_call_id: request.toolCall.id,
          name: request.toolCall.name,
        });
      }
      return handler(request);
    },

    afterAgent() {
      if (history.length > 0) {
        const unique = new Set(history.map(([n, h]) => `${n}:${h}`)).size;
        console.log(
          `[LoopDetection] Summary: ${history.length} tool calls tracked, ` +
          `${unique} unique signatures, ${interventionCount} interventions, stopped=${stopped}`,
        );
      }
    },
  };
}
