/**
 * Tool-scope middleware — the native engine's enforcement of an agent's two
 * tool lists (`tools`, `disallowed_tools`; resolved by `shared/tool-lists.ts`).
 *
 * The shape is deepagents' own `createToolExclusionMiddleware` (1.14.1): the
 * one seam that reaches every tool a graph binds, its filesystem and `task`
 * tools included, on the parent and on every sub-agent graph alike.
 *  - `wrapModelCall` removes the out-of-scope tools from `request.tools`, so
 *    the model never sees them.
 *  - `wrapToolCall` answers a call to an out-of-scope tool (a model can still
 *    name one it was never shown) with an error `ToolMessage` carrying
 *    `outOfScopeMessage`, without running the handler.
 *
 * Where it sits: after path normalization, so the `.stigmer/` confinement
 * below reads canonical virtual paths, and AHEAD of the approval gate, so a
 * listed-out call is refused before it could reach an approval card. It is
 * installed whenever the scope carries a list, independent of the gate: under
 * auto-approve-all the gate is absent and the lists still bind.
 *
 * How a refusal reaches the timeline: a call that never runs its handler
 * fires no tool events, so the middleware says so itself, on the graph's
 * custom stream ({@link TOOL_REFUSED_EVENT}, through the runtime's `writer`),
 * and the native translator folds it into the call's row as a failure with
 * this message — no approval card, no provenance, the row settled as the
 * refusal happens rather than at the end of the turn.
 *
 * How a tool is attributed:
 *  - An MCP tool belongs to the server whose `serverToolMap` entry holds that
 *    very tool OBJECT; hiding is exact even when two servers name a tool
 *    alike. A call carries a name and, from the tool node, the tool object;
 *    the object decides, and a bare name is the fallback, refused unless
 *    every server carrying that name allows it (stigmer#1860 is the name
 *    collision this inherits).
 *  - A tool of a platform server (the synthesized channel, conversation and
 *    memory attachments, `TurnMcp.platformServerSlugs`) is always in scope:
 *    no plugin can name them and an agent without them cannot answer its
 *    channel.
 *  - Every other tool is the engine's, judged by its native name
 *    (`NATIVE_TOOL_COVERS`): `think` is the platform's, a name the table
 *    does not carry is an engine extra (hidden only by an allow-list).
 *
 * `Read` excluded is the one exception to "out of scope is hidden":
 * `read_file` is how the agent reads the platform's `.stigmer/` content (its
 * skills, attached inputs, the approved plan; `platform-route.ts`) and the
 * results and history deepagents offloads from the agent's own turn
 * (`/large_tool_results/`, `/conversation_history/`). Those are the platform's
 * and the agent's own outputs, not the workspace (`platform-route.ts` states
 * the one overlap), so `read_file` stays bound and visible and a call is
 * refused unless {@link ToolScopeConfig.admitsConfinedRead} admits its path,
 * which for an offload root checks the real path on disk, so a symlink cannot
 * stretch the confinement over the workspace.
 *
 * Pinned by `__tests__/tool-scope.test.ts` on a real deepagents graph.
 */

import { ToolMessage } from "@langchain/core/messages";
import { NATIVE_TOOL_COVERS, outOfScopeMessage, type ToolScope } from "../shared/tool-lists.js";
import type { StigmerMiddleware, ToolCallRequest } from "./types.js";

/**
 * The custom-stream event a refusal writes (`translator.ts` reads it). The
 * payload is the call as the model made it and the message: a refused call
 * fires no tool events, so nothing else on the stream carries them. The
 * approval gate writes it too when a hook refuses a call, with the hook's
 * provenance beside it.
 */
export const TOOL_REFUSED_EVENT = "stigmer.tool_refused";

/** The {@link TOOL_REFUSED_EVENT} payload. */
export interface ToolRefusedPayload {
  readonly name: typeof TOOL_REFUSED_EVENT;
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly input: Record<string, unknown>;
  readonly message: string;
  /** Set when a hook refused the call: `"hook"`. A tool list's refusal carries none. */
  readonly policy_source?: "hook";
  /** The refusing plugin's slug (`""` for the agent's own hooks block), beside `policy_source`. */
  readonly policy_hook?: string;
}

/** The runtime's custom-stream writer, when the graph streams with one. */
export function customStreamWriterOf<T>(runtime: unknown): ((chunk: T) => void) | undefined {
  if (runtime === null || typeof runtime !== "object" || !("writer" in runtime)) return undefined;
  const writer = (runtime as { writer: unknown }).writer;
  return typeof writer === "function" ? (chunk) => void writer(chunk) : undefined;
}

/** The native file-read tool and the argument that names its file. */
const READ_TOOL = "read_file";
const READ_PATH_ARG = "file_path";

export interface ToolScopeConfig {
  /** The scope this graph enforces: the agent's, or a sub-agent's narrowed from it. */
  readonly scope: ToolScope;
  /** Each MCP server's tool objects, by slug — the identity a tool is attributed to its server by. */
  readonly serverToolMap: ReadonlyMap<string, readonly unknown[]>;
  /** The platform's own servers, outside every list. */
  readonly platformServerSlugs: ReadonlySet<string>;
  /**
   * Whether `read_file` may still read this canonical virtual path when the
   * scope excludes `Read`: the platform route and deepagents' offload roots,
   * confined on disk (`platform-route.ts` `confinedReadAdmission`). Injected
   * by the harness, which knows the workspace root this middleware does not.
   */
  readonly admitsConfinedRead: (virtualPath: string) => Promise<boolean>;
}

function toolNameOf(tool: unknown): string | undefined {
  if (tool === null || typeof tool !== "object" || !("name" in tool)) return undefined;
  const name = (tool as { name: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/** The middleware; see the module header. Install only when `scope.restricted`. */
export function createToolScopeMiddleware(config: ToolScopeConfig): StigmerMiddleware {
  const { scope, platformServerSlugs, admitsConfinedRead } = config;

  const serverOfTool = new Map<unknown, string>();
  const serversOfName = new Map<string, string[]>();
  for (const [slug, tools] of config.serverToolMap) {
    for (const tool of tools) {
      serverOfTool.set(tool, slug);
      const name = toolNameOf(tool);
      if (name === undefined) continue;
      const slugs = serversOfName.get(name) ?? [];
      slugs.push(slug);
      serversOfName.set(name, slugs);
    }
  }

  const mcpToolInScope = (slug: string, name: string): boolean =>
    platformServerSlugs.has(slug) || scope.allowsMcpTool(slug, name);

  /** Whether a tool the model is shown stays visible: `read_file` always does (the header's exception). */
  const visible = (tool: unknown): boolean => {
    const name = toolNameOf(tool);
    if (name === undefined) return true;
    const slug = serverOfTool.get(tool);
    if (slug !== undefined) return mcpToolInScope(slug, name);
    if (name === READ_TOOL) return true;
    return scope.allowsEngineTool(name, NATIVE_TOOL_COVERS);
  };

  /** Whether a call may run, from the tool object when the tool node supplies it, else from the name. */
  const callable = async (request: ToolCallRequest): Promise<boolean> => {
    const { name, args } = request.toolCall;
    const objectSlug = serverOfTool.get(request.tool);
    if (objectSlug !== undefined) return mcpToolInScope(objectSlug, name);
    const nameSlugs = serversOfName.get(name);
    if (nameSlugs !== undefined) return nameSlugs.every((slug) => mcpToolInScope(slug, name));
    if (scope.allowsEngineTool(name, NATIVE_TOOL_COVERS)) return true;
    const path = args[READ_PATH_ARG];
    return name === READ_TOOL && typeof path === "string" && (await admitsConfinedRead(path));
  };

  return {
    name: "ToolScopeMiddleware",

    wrapModelCall(request, handler) {
      if (!request.tools) return handler(request);
      return handler({ ...request, tools: request.tools.filter(visible) });
    },

    async wrapToolCall(request, handler) {
      if (await callable(request)) return handler(request);
      const { name, id, args } = request.toolCall;
      const message = outOfScopeMessage(name, scope);
      customStreamWriterOf<ToolRefusedPayload>(request.runtime)?.({ name: TOOL_REFUSED_EVENT, tool_call_id: id ?? "", tool_name: name, input: args, message });
      return new ToolMessage({ content: message, tool_call_id: id ?? "", name, status: "error" });
    },
  };
}
