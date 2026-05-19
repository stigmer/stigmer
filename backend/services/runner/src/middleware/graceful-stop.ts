/**
 * Platform-level graceful stop middleware.
 *
 * Activated externally when the platform signals the runner to stop
 * (e.g. via ExecutionControlSignal.STOP from the updateStatus RPC).
 * Once activated, blocks all tool execution and gives the model one
 * final tool-free round to produce a summary.
 *
 * Always injected into the agent graph. Inert until activate() is called.
 */

import { ToolMessage, SystemMessage } from "@langchain/core/messages";
import type { StigmerMiddleware } from "./types.js";

const DEFAULT_STOP_MESSAGE =
  "The platform has requested this execution to stop. All tool calls are " +
  "now blocked. Respond with a concise summary of what you accomplished " +
  "and what work remains so the user can continue in their next session.";

export interface GracefulStopMiddleware extends StigmerMiddleware {
  readonly activated: boolean;
  activate(reason?: string): void;
  forSubAgent(): StigmerMiddleware;
}

export function createGracefulStopMiddleware(): GracefulStopMiddleware {
  let _activated = false;
  let _messageInjected = false;
  let _reason = "";

  const middleware: GracefulStopMiddleware = {
    name: "GracefulStopMiddleware",

    get activated() {
      return _activated;
    },

    activate(reason = "") {
      if (!_activated) {
        _activated = true;
        _reason = reason;
        console.warn(
          `[PLATFORM_STOP] GracefulStopMiddleware activated (reason=${reason || "unspecified"})`,
        );
      }
    },

    afterModel() {
      if (!_activated || _messageInjected) return;
      _messageInjected = true;
      const msg = _reason || DEFAULT_STOP_MESSAGE;
      return { messages: [new SystemMessage({ content: msg })] };
    },

    async wrapToolCall(request, handler) {
      if (!_activated) return handler(request);

      console.log(
        `[PLATFORM_STOP] Blocking tool '${request.toolCall.name}' (id=${request.toolCall.id})`,
      );
      return new ToolMessage({
        content:
          "[Execution stopped by platform: tool execution blocked. " +
          "Summarize your progress for the user.]",
        tool_call_id: request.toolCall.id,
        name: request.toolCall.name,
      });
    },

    forSubAgent(): StigmerMiddleware {
      return {
        name: "GracefulStopSubAgentView",

        afterModel() {
          return middleware.afterModel!({} as any, {});
        },

        async wrapToolCall(request, handler) {
          return middleware.wrapToolCall!(request, handler);
        },
      };
    },
  };

  return middleware;
}
