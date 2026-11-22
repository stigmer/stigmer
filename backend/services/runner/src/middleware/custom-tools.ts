/**
 * The host app's own tools on the Stigmer harness: the middleware that
 * pauses every admitted call of one until the host answers
 * (`shared/custom-tools.ts` says what the tools are and who is offered them).
 *
 * A call of a custom tool never runs anything of the runner's. This
 * middleware checks the call's input against the tool's schema with the
 * control plane's own check (`@stigmer/tool-vocabulary`
 * `customToolInputProblem`) and refuses a mismatch to the model, which
 * reads why and may call again; the refusal reaches the call's row through
 * the custom stream ({@link writeToolRefused}), as every refusal of a call
 * that never runs does. A call that matches pauses the graph with
 * `interrupt()`, its payload marked `custom_tool`, so the turn settles
 * waiting and the runtime records the call as the host's
 * (`execute-deep-agent/turn-settle.ts`). On the resume the host's answer
 * comes back by the call's interrupt (`execute-deep-agent/hitl.ts`), and the
 * handler runs the tool, which hands the model that answer
 * (`execute-deep-agent/custom-tools.ts`).
 *
 * Where it sits: right after the tool scope and ahead of the approval gate
 * and the error hints (`index.ts`). The pause must be taken in a
 * middleware: an `interrupt()` thrown inside a tool's body reaches the
 * error hints, which return it to the model as an error, and the graph
 * never pauses. It is installed whenever the turn offers custom tools,
 * under the run-wide bypass too, since no approval stands in for the
 * host's answer; and on the root graph alone, the one that is offered
 * them. The approval gate never sees a custom call, so no hook, lease or
 * bypass decides one.
 *
 * Proven by the custom-tool contract both engines run
 * (`__test-utils__/custom-tool-contract/`) and `__tests__/custom-tools.test.ts`.
 */

import { ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { customToolInputProblem } from "@stigmer/tool-vocabulary";

import { CUSTOM_TOOL_WAITING_MESSAGE, type CustomToolOffer } from "../shared/custom-tools.js";
import { writeToolRefused } from "./tool-scope.js";
import type { StigmerMiddleware } from "./types.js";

/** What the middleware is built from: the tools the turn offers its main agent. */
export interface CustomToolGateConfig {
  readonly tools: readonly CustomToolOffer[];
}

/**
 * The interrupt payload of a custom call: the facts `hitl.ts` reads for any
 * pending interrupt (the call, its tool, the waiting line), and the mark
 * that the host answers it.
 */
export interface CustomToolInterruptPayload {
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly mcp_server_slug: "";
  readonly message: string;
  readonly custom_tool: true;
}

/** The middleware; see the module header. */
export function createCustomToolGateMiddleware(config: CustomToolGateConfig): StigmerMiddleware {
  const byName = new Map(config.tools.map((tool) => [tool.name, tool]));
  return {
    name: "CustomToolGateMiddleware",

    async wrapToolCall(request, handler) {
      const { id, name, args } = request.toolCall;
      const tool = byName.get(name);
      if (tool === undefined) return handler(request);
      const problem = customToolInputProblem(tool, args);
      if (problem !== undefined) {
        writeToolRefused(request, { message: problem });
        return new ToolMessage({ content: problem, tool_call_id: id ?? "", name, status: "error" });
      }
      const payload: CustomToolInterruptPayload = { tool_call_id: id ?? "", tool_name: name, mcp_server_slug: "", message: CUSTOM_TOOL_WAITING_MESSAGE, custom_tool: true };
      interrupt(payload);
      return handler(request);
    },
  };
}
