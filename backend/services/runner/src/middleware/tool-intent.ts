/**
 * Tool-intent middleware — model-authored intent titles for shell tool calls
 * (issue #276).
 *
 * The thread UI titles every shell row with the bare category label ("Shell");
 * only the model knows *why* it is running a command, so a host-side rename
 * can never close that gap. This middleware lets the model author the title:
 * at model-call time it presents a schema-extended clone of the shell tool
 * that adds one optional `description` argument. The model fills it in, the
 * argument rides the tool call's args verbatim through checkpoints and the
 * persisted ToolCall proto (no new state, no proto change), and the React SDK
 * renders it as the row title with the command as secondary text.
 *
 * Why this seam:
 * - The `execute` tool is owned by the deepagents library; its schema is not
 *   ours to edit. `wrapModelCall` is the framework's intended point for
 *   reshaping the model-visible tool list — langchain's own llmToolSelector
 *   middleware swaps `request.tools` through exactly this hook.
 * - Execution is untouched by construction: the agent's ToolNode is built
 *   once from the ORIGINAL tools, and the original schema parses with strip
 *   semantics, so the extra argument is dropped before the backend's
 *   `execute(command)` ever runs. Approval fingerprints are equally
 *   unaffected (`description` is not a salient arg field).
 * - The argument name deliberately matches the Cursor harness, whose built-in
 *   Shell tool already carries a model-authored `description` — both
 *   harnesses converge on one wire key and the SDK reads a single field.
 *
 * The swapped-in declaration is a `StructuredToolParams` object — langchain's
 * first-class shape for a non-executable, bind-time-only tool definition
 * ("the most minimal interface … to be passed to a LLM for tool calling").
 * A same-name RUNNABLE replacement is rejected by the agent's wrapModelCall
 * validation (it would threaten ToolNode execution identity); a params
 * object is exactly the declaration-without-execution the validation exists
 * to protect, and the graph keeps executing the untouched original. Schema
 * extension happens at the JSON-schema level via @langchain/core's interop
 * serializer — the runner's zod (v3) must never construct fields inside the
 * library's zod (v4) schema object.
 */

import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { classifyTool } from "../shared/tool-kind.js";
import type { StigmerMiddleware } from "./types.js";

/**
 * The wire name of the intent argument. Shared with the Cursor harness's
 * built-in Shell tool and read by the SDK's tool presentation layer — the
 * three surfaces must agree on this key.
 */
export const INTENT_ARG = "description";

/**
 * The behavior-shaping prompt for the intent argument (owner-approved
 * wording, issue #276). This is prompt engineering, not documentation:
 * changing it changes what the model writes into every shell row title.
 */
export const INTENT_ARG_PROMPT =
  "A short present-tense phrase describing what this command does and why, " +
  "shown to the user as the title of this action (5-10 words, e.g. " +
  "'Run unit tests for the parser'). Do not restate the command syntax.";

/** Structural shape of a bindable structured tool, checked at runtime. */
interface StructuredToolLike {
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
}

function isStructuredToolLike(candidate: unknown): candidate is StructuredToolLike {
  if (candidate == null || typeof candidate !== "object") return false;
  const t = candidate as Record<string, unknown>;
  return (
    typeof t.name === "string" &&
    typeof t.description === "string" &&
    "schema" in t
  );
}

interface JsonObjectSchema {
  readonly type: "object";
  readonly properties?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

function isJsonObjectSchema(schema: unknown): schema is JsonObjectSchema {
  return (
    schema != null &&
    typeof schema === "object" &&
    (schema as Record<string, unknown>).type === "object"
  );
}

/**
 * Returns a bind-time `StructuredToolParams` declaration for `original`
 * whose schema carries the optional intent argument, or `original` itself
 * when the tool is not a shell tool, is not schema-extendable, or already
 * defines an argument with that name (a real argument must never be
 * shadowed by presentation metadata).
 *
 * Unexpected schemas pass through unchanged on purpose: a missing intent
 * title degrades to today's rendering, while a mangled schema would break
 * the tool for the whole execution.
 */
function maybeExtendShellTool(original: unknown): unknown {
  if (!isStructuredToolLike(original)) return original;
  if (classifyTool(original.name) !== ToolKind.SHELL) return original;

  let jsonSchema: unknown;
  try {
    jsonSchema = toJsonSchema(original.schema as Parameters<typeof toJsonSchema>[0]);
  } catch {
    return original;
  }
  if (!isJsonObjectSchema(jsonSchema)) return original;

  const properties = jsonSchema.properties ?? {};
  if (INTENT_ARG in properties) return original;

  // A plain frozen declaration, deliberately NOT an executable tool: the
  // graph's ToolNode executes the ORIGINAL registered tool (it is built from
  // the registered tools, not from the model request), and the agent's
  // wrapModelCall validation only forbids swapping same-name EXECUTABLE
  // instances. `isStructuredToolParams` recognizes this shape, so every
  // provider's bindTools converts it exactly like a structured tool.
  return Object.freeze({
    name: original.name,
    description: original.description,
    schema: {
      ...jsonSchema,
      properties: {
        ...properties,
        [INTENT_ARG]: { type: "string", description: INTENT_ARG_PROMPT },
      },
    },
  });
}

/**
 * Creates the middleware. Install on the parent stack AND on every sub-agent
 * stack (subagent-wiring.ts) — sub-agent shell rows render in the same
 * thread and must carry the same titles.
 */
export function createToolIntentMiddleware(): StigmerMiddleware {
  // One clone per original tool instance: repeated model calls (and repeated
  // turns on the same graph) bind a referentially stable clone instead of
  // re-serializing the schema every round.
  const cloneCache = new WeakMap<object, unknown>();

  const extendCached = (candidate: unknown): unknown => {
    if (candidate == null || typeof candidate !== "object") return candidate;
    const cached = cloneCache.get(candidate);
    if (cached !== undefined) return cached;
    const extended = maybeExtendShellTool(candidate);
    cloneCache.set(candidate, extended);
    return extended;
  };

  return {
    name: "StigmerToolIntentMiddleware",
    async wrapModelCall(request, handler) {
      const tools = request.tools;
      if (!tools || tools.length === 0) return handler(request);

      let changed = false;
      const mapped = tools.map((t) => {
        const extended = extendCached(t);
        if (extended !== t) changed = true;
        return extended;
      });

      return handler(changed ? { ...request, tools: mapped } : request);
    },
  };
}
