/**
 * Shell middleware: the native graph's `execute` calls run the runner's own
 * shell tool (`execute-deep-agent/shell-tool.ts`), which streams, takes a
 * raisable timeout and stops with the turn, instead of deepagents' tool,
 * which does none of these.
 *
 * Why this seam, and not a tool of another name or a different backend:
 * deepagents' filesystem middleware drops every model-bound tool named
 * `execute` that is not its own, and the profile's excluded tools filter by
 * name, so a runner tool registered under that name never reaches the model.
 * deepagents' tool must stay registered, and the shell's name must stay
 * `execute` (the SDKs, the console, hooks and the CLI read it). LangChain's
 * middleware has the two hooks this needs:
 *  - `wrapModelCall` reshapes the model-visible tool list. The bound
 *    `execute` is replaced by a frozen declaration of the runner's schema:
 *    deepagents' description and `command`, plus `timeout`. A declaration,
 *    never an executable: the agent refuses a same-name executable at the
 *    model call (the `tool-intent.ts` header records it), and that
 *    middleware has presented an extended shell declaration this way since
 *    #276. This one sits right before it, so `tool-intent` extends this
 *    declaration with `description`.
 *  - `wrapToolCall` hands each `execute` call the runner's tool,
 *    `handler({ ...request, tool })`, the shape LangChain documents for
 *    supplying a call's implementation; the ToolNode runs `request.tool`
 *    with the call's config and its merged abort signal, which carries the
 *    turn's stop.
 *
 * This sits outside the scope, gate and truncation middleware, so they see
 * an `execute` call and its result exactly as before: a held call never
 * reaches this tool. It is installed only on a graph whose backend can run a
 * shell; a plan-mode graph binds no `execute` and gets no shell middleware,
 * so a call to `execute` there still finds no tool. On the parent and on
 * every sub-agent stack, each over its own backend (a saved subagent's shell
 * holds its own values).
 *
 * Pinned on a real graph by `execute-deep-agent/__tests__/shell-binding.test.ts`
 * (the one `execute` the model sees, the call that runs this tool, the gate
 * still holding it, a chunk reaching the stream under the call's id), so a
 * deepagents or LangChain upgrade that moves either hook fails loudly.
 */

import { toJsonSchema } from "@langchain/core/utils/json_schema";

import { SHELL_TIMEOUT_ARG_PROMPT, SHELL_TOOL_NAME } from "../activities/execute-deep-agent/shell-tool.js";
import type { StigmerMiddleware } from "./types.js";

/** The argument the runner's shell adds to deepagents' schema. */
export const TIMEOUT_ARG = "timeout";

interface DeclaredTool {
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
}

function isDeclaredTool(candidate: unknown): candidate is DeclaredTool {
  if (candidate == null || typeof candidate !== "object") return false;
  const t = candidate as Record<string, unknown>;
  return typeof t.name === "string" && typeof t.description === "string" && "schema" in t;
}

/**
 * The runner's declaration for deepagents' bound `execute`: its description
 * and schema, plus `timeout`. `original` itself when it is not that tool or
 * its schema is not an object (a mangled schema would break the shell for
 * the whole turn; an unextended one only loses the raisable timeout).
 */
function declareShell(original: unknown): unknown {
  if (!isDeclaredTool(original) || original.name !== SHELL_TOOL_NAME) return original;
  let object: { readonly properties?: Record<string, unknown> };
  try {
    const schema: unknown = toJsonSchema(original.schema as Parameters<typeof toJsonSchema>[0]);
    if (schema == null || typeof schema !== "object" || (schema as { type?: unknown }).type !== "object") return original;
    object = schema as { readonly properties?: Record<string, unknown> };
  } catch {
    return original;
  }
  return Object.freeze({
    name: original.name,
    description: original.description,
    schema: {
      ...object,
      properties: {
        ...(object.properties ?? {}),
        [TIMEOUT_ARG]: { type: "number", exclusiveMinimum: 0, description: SHELL_TIMEOUT_ARG_PROMPT },
      },
    },
  });
}

/** Install on a shell-capable graph's stack, right before `tool-intent`, with that graph's shell tool. */
export function createShellMiddleware(options: { readonly tool: unknown }): StigmerMiddleware {
  // One declaration per bound tool instance, as tool-intent keeps one clone.
  const declared = new WeakMap<object, unknown>();
  const declare = (candidate: unknown): unknown => {
    if (candidate == null || typeof candidate !== "object") return candidate;
    const cached = declared.get(candidate);
    if (cached !== undefined) return cached;
    const shaped = declareShell(candidate);
    declared.set(candidate, shaped);
    return shaped;
  };

  return {
    name: "StigmerShellMiddleware",
    async wrapModelCall(request, handler) {
      const tools = request.tools;
      if (!tools || tools.length === 0) return handler(request);
      let changed = false;
      const mapped = tools.map((t) => {
        const shaped = declare(t);
        if (shaped !== t) changed = true;
        return shaped;
      });
      return handler(changed ? { ...request, tools: mapped } : request);
    },
    async wrapToolCall(request, handler) {
      if (request.toolCall.name !== SHELL_TOOL_NAME) return handler(request);
      return handler({ ...request, tool: options.tool });
    },
  };
}
