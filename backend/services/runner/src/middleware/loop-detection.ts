/**
 * Loop detection middleware for autonomous agents.
 *
 * Detects and prevents infinite loops by tracking tool invocations:
 *
 * afterModel — inspects AIMessage tool_calls, tracks signatures
 *   (tool name + param hash) in a sliding window, injects
 *   SystemMessage interventions when repetitive patterns are detected.
 *
 * wrapToolCall — when the total-repetition threshold has been exceeded,
 *   short-circuits tool execution with a ToolMessage halt notice.
 */

import { createHash } from "node:crypto";
import { ToolMessage, SystemMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/core/messages";
import type { StigmerMiddleware, LoopDetectionConfig } from "./types.js";

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
): SystemMessage {
  if (isFinal) {
    return new SystemMessage({
      content:
        `\u26a0\ufe0f LOOP DETECTED: Critical repetition limit reached.\n\n` +
        `You have called '${toolName}' ${totalCount} times with similar parameters. ` +
        `This indicates you are stuck in a loop and unable to make progress.\n\n` +
        `**You MUST conclude your work now:**\n` +
        `1. Summarize what you have learned so far\n` +
        `2. Explain the obstacle preventing progress\n` +
        `3. Provide your best assessment based on available information\n` +
        `4. Do NOT call '${toolName}' again\n\n` +
        `Conclude gracefully with the information you have gathered.`,
    });
  }

  return new SystemMessage({
    content:
      `\u26a0\ufe0f LOOP WARNING: Repetitive pattern detected.\n\n` +
      `You have called '${toolName}' ${consecutiveCount} times in a row. ` +
      `This suggests you may be stuck or approaching the problem incorrectly.\n\n` +
      `**Recommended actions:**\n` +
      `1. Try a completely different approach or tool\n` +
      `2. Re-examine your assumptions about the problem\n` +
      `3. Consider if you have enough information to conclude\n` +
      `4. Avoid calling '${toolName}' again unless absolutely necessary\n\n` +
      `Adapt your strategy to make progress.`,
  });
}

export function createLoopDetectionMiddleware(
  config: Partial<LoopDetectionConfig> = {},
): StigmerMiddleware {
  const cfg = { ...DEFAULTS, ...config };
  let history: Signature[] = [];
  let interventionCount = 0;
  let stopped = false;

  return {
    name: "LoopDetectionMiddleware",

    beforeAgent() {
      history = [];
      interventionCount = 0;
      stopped = false;
    },

    afterModel(state) {
      if (!cfg.enabled || stopped) return;

      const messages = (state.messages ?? []) as unknown[];
      let lastAi: AIMessage | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as { _getType?: () => string; tool_calls?: unknown[] };
        if (msg?._getType?.() === "ai") {
          lastAi = msg as unknown as AIMessage;
          break;
        }
      }

      if (!lastAi) return;
      const toolCalls = (lastAi as unknown as { tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }> }).tool_calls;
      if (!toolCalls || toolCalls.length === 0) return;

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
          const intervention = buildIntervention(totalToolName, consCount, totalCount, true);
          interventionCount++;
          stopped = true;
          console.warn(
            `[LoopDetection] STOP: ${totalToolName} called ${totalCount} times (threshold: ${cfg.totalThreshold})`,
          );
          return { messages: [intervention] };
        }

        if (consCount >= cfg.consecutiveThreshold && interventionCount === 0) {
          const intervention = buildIntervention(consToolName, consCount, totalCount, false);
          interventionCount++;
          console.warn(
            `[LoopDetection] WARNING: ${consToolName} called ${consCount} times in a row (threshold: ${cfg.consecutiveThreshold})`,
          );
          return { messages: [intervention] };
        }
      }
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
