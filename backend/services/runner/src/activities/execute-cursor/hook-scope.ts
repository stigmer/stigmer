/**
 * The agent's tool lists as the Cursor hook evaluates them.
 *
 * The hook (`hook-script.ts`) is a bash script with an inline Node snippet,
 * spawned by Cursor in a process of its own: it cannot load the runner's
 * modules, and the runner may run bundled. So the runner hands it the scope
 * already answered. Every answer here is a call into `shared/tool-lists.ts`
 * (`ToolScope`), the one home of the resolution rules; the hook only looks
 * names up in the tables, so the two engines cannot read a list differently.
 *
 * What the table answers, and how each lookup stays exact:
 *  - Built-ins, by the hook's own names (`CURSOR_HOOK_TOOL_COVERS`); a name
 *    the table lacks is an engine extra, refused only under an allow-list
 *    (`ToolScope.allowsCovering([])`).
 *  - `Read` when the lists exclude it: still allowed for a file whose real
 *    path lies inside the platform dir (the agent's skills, attached inputs
 *    and approved plan, the platform's content and not the workspace's), on a
 *    turn whose `.stigmer` link points there. Real path, not prefix: a
 *    repository's own `.stigmer` link on an unlinked turn, or a link inside
 *    platform content pointing out, would otherwise stretch the confinement
 *    to any target. The native engine admits the same set
 *    (`execute-deep-agent/platform-route.ts` `confinedReadAdmission`).
 *  - MCP tools, by server and tool (`ToolScope.mcpTable`): every tool the turn
 *    discovered and every one an entry names, plus one shared answer for the
 *    rest of a server and one for any other server. The platform's own
 *    attachment servers are always in scope.
 *  - Sub-agent types for `subagentStart` and a `Task` call's `subagent_type`
 *    (`ToolScope.subAgentTypeTable`). A second line only, never the guard:
 *    the `@cursor/sdk` 1.0.31 local runtime fires neither hook for a `task`
 *    call (live probe, 2026-10-05, `cursor-hook-protocol.live.test.ts`), so an
 *    `Agent(type, …)` type list is refused at setup on this engine
 *    (`turn-setup.ts` `checkToolScope`) and these lookups bind only on a
 *    runtime that does fire them.
 *
 * What it cannot answer, by construction: which sub-agent made a call. The
 * `preToolUse` payload carries no sub-agent id, so a sub-agent with lists of
 * its own is refused at setup instead (`turn-setup.ts` `checkToolScope`).
 */

import { approvalCategory } from "./approval-policy.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import type { McpToolListing } from "../../shared/mcp-tool-listing.js";
import {
  CURSOR_HOOK_TOOL_COVERS,
  outOfScopeMessage,
  type ClaudeTool,
  type McpScopeTable,
  type SubAgentTypeTable,
  type ToolScope,
} from "../../shared/tool-lists.js";

/** Where the called tool's name goes in {@link HookToolScope.refusal}. Baked into the hook script. */
export const TOOL_NAME_PLACEHOLDER = "{{tool_name}}";

/** Cursor's `preToolUse` name for an MCP call (`MCP:<tool>`): the MCP event decides those, by server. Baked into the hook script. */
export const CURSOR_HOOK_MCP_PREFIX = "MCP:";

/**
 * The prefix that keeps a scope refusal's ledger key apart from every
 * approval key (an approval category or an MCP tool name). Baked into the
 * hook script; `approval-state.ts` `scopeRefusalToken` encodes it.
 */
export const SCOPE_KEY_PREFIX = "scope:";

/**
 * The one refusal key every engine extra shares (a name with no Claude tool
 * in its taxonomy's table). The lists treat extras as one class, refused
 * together under an allow-list, and the hook's and the stream's names for an
 * extra need not agree (`GenerateImage` and `generateImage`), so the class is
 * the identity both sides can compute. Baked into the hook script.
 */
export const ENGINE_EXTRA_SCOPE_KEY = "engine-extra";

/** One built-in the hook knows by name. */
export interface HookBuiltinScope {
  readonly allowed: boolean;
  /** The ledger key a refusal is recorded under ({@link scopeKey}). */
  readonly key: string;
}

/** The scope the approval state file carries (`ApprovalStateFile.toolScope`). */
export interface HookToolScope {
  /** False for an agent with no lists: the hook skips its scope arm. */
  readonly restricted: boolean;
  /** The refusal the model reads (`outOfScopeMessage`), with {@link TOOL_NAME_PLACEHOLDER} for the tool. */
  readonly refusal: string;
  /** Per hook built-in name. */
  readonly builtins: Readonly<Record<string, HookBuiltinScope>>;
  /** The answer for a built-in name `builtins` lacks. */
  readonly otherBuiltins: boolean;
  /**
   * The platform dir's real path, inside which an excluded `Read` may still
   * reach a file by its real path; "" on a turn whose `.stigmer` link does
   * not point at the platform dir (no platform content to read).
   */
  readonly readRoot: string;
  readonly mcp: McpScopeTable;
  readonly subAgentTypes: SubAgentTypeTable;
}

/**
 * The scope as the state file carries it: base64 of its JSON. Opaque on
 * purpose. The bash half of the hook reads its flags by grepping the state
 * (`"autoApproveAll":true`), and these tables are keyed by names an MCP
 * server chooses: a tool named `autoApproveAll` would otherwise put that
 * exact text into the file. Only the Node snippet decodes it.
 */
export function encodeHookToolScope(scope: HookToolScope): string {
  return Buffer.from(JSON.stringify(scope), "utf-8").toString("base64");
}

/** The inverse of {@link encodeHookToolScope}, for tests and diagnostics. */
export function decodeHookToolScope(encoded: string): HookToolScope {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf-8")) as HookToolScope;
}

/** The scope of an agent with no lists. */
export const UNRESTRICTED_HOOK_SCOPE: HookToolScope = {
  restricted: false,
  refusal: "",
  builtins: {},
  otherBuiltins: true,
  readRoot: "",
  mcp: { servers: {}, otherServers: true },
  subAgentTypes: { types: {}, otherTypes: true },
};

/**
 * The key a built-in's scope refusal is recorded and attributed under, the
 * same in both of Cursor's taxonomies: a gated built-in's approval category
 * (`Write` and `edit` alike), else the Claude tools the name covers in its
 * taxonomy's table (`Read` and `read` alike, `SemanticSearch` and `semSearch`
 * alike), else {@link ENGINE_EXTRA_SCOPE_KEY}. An MCP tool's key is its
 * `mcpToolKey` (`server/tool`), which no built-in key can equal.
 */
export function scopeKey(name: string, table: ReadonlyMap<string, readonly ClaudeTool[]>): string {
  const category = approvalCategory(name);
  if (category) return category;
  const covers = table.get(name);
  return covers && covers.length > 0 ? [...covers].sort().join("+") : ENGINE_EXTRA_SCOPE_KEY;
}

/**
 * The scope keys whose refusals name the CALL, not only the tool, because the
 * lists may exclude part of the tool: an excluded `Read` is confined to the
 * platform's content, and `Agent(type, …)` excludes some types. A refusal of
 * these carries a discriminator (the path as given, the normalized sub-agent
 * type), so the turn boundary settles only the row that was refused. Baked
 * into the hook script; read by `boundary-rows.ts`.
 */
export const READ_SCOPE_KEY = scopeKey("Read", CURSOR_HOOK_TOOL_COVERS);
export const AGENT_SCOPE_KEY = scopeKey("Task", CURSOR_HOOK_TOOL_COVERS);

/** What {@link compileHookToolScope} reads, all of it from the turn's record. */
export interface HookToolScopeInput {
  readonly scope: ToolScope;
  readonly servers: readonly Pick<ResolvedMcpServer, "slug">[];
  /** What the turn start listed of each plugin server's tools (`TurnMcp.listing`). */
  readonly listing: McpToolListing | undefined;
  /** The synthesized attachments' slugs: the platform's servers, outside every list. */
  readonly platformServerSlugs: ReadonlySet<string>;
  /** {@link HookToolScope.readRoot}, resolved by the caller (`turn-setup.ts` `platformReadRoot`). */
  readonly readRoot: string;
  /** The custom sub-agent names registered with the SDK. */
  readonly subAgentTypes: readonly string[];
}

/** Answer the main agent's scope for the hook. */
export function compileHookToolScope(input: HookToolScopeInput): HookToolScope {
  const { scope, servers, platformServerSlugs } = input;
  if (!scope.restricted) return UNRESTRICTED_HOOK_SCOPE;

  const builtins = Object.fromEntries(
    [...CURSOR_HOOK_TOOL_COVERS.keys()].map((name): [string, HookBuiltinScope] => [
      name,
      { allowed: scope.allowsEngineTool(name, CURSOR_HOOK_TOOL_COVERS), key: scopeKey(name, CURSOR_HOOK_TOOL_COVERS) },
    ]),
  );

  const listed = new Map((input.listing?.listed ?? []).map(({ server, tools }) => [server, tools]));
  const known = new Map<string, readonly string[]>();
  for (const server of servers) {
    if (!platformServerSlugs.has(server.slug)) known.set(server.slug, listed.get(server.slug) ?? []);
  }
  const table = scope.mcpTable(known);
  const mcp: McpScopeTable = {
    servers: {
      ...table.servers,
      ...Object.fromEntries([...platformServerSlugs].map((slug) => [slug, { tools: {}, otherTools: true }])),
    },
    otherServers: table.otherServers,
  };

  return {
    restricted: true,
    refusal: outOfScopeMessage(TOOL_NAME_PLACEHOLDER, scope),
    builtins,
    otherBuiltins: scope.allowsCovering([]),
    readRoot: input.readRoot,
    mcp,
    subAgentTypes: scope.subAgentTypeTable(input.subAgentTypes),
  };
}
