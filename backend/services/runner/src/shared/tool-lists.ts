/**
 * An agent's two tool lists — `tools` ("only these") and `disallowed_tools`
 * ("never these") — in Claude Code's vocabulary, resolved the way Claude Code
 * resolves a sub-agent's lists, for both engines.
 *
 * Pure: no engine import, no I/O. Each harness asks this module one question
 * per tool ("is this in scope?") in its own names, through the name tables
 * below, so the two engines cannot disagree on what a list means.
 *
 * The rules, from Claude Code's sub-agent reference:
 *  - `disallowed_tools` is applied first, then `tools` against what remains;
 *    an empty `tools` means every tool.
 *  - An entry may carry a specifier in parentheses (`Bash(git push *)`); it is
 *    accepted and governs the whole tool, in either list.
 *  - `Agent(type, …)` in the main agent's `tools` limits which sub-agents it
 *    may start (types match case-insensitively); inside a sub-agent the type
 *    list is ignored.
 *  - A sub-agent starts from its parent's resolved set and can only narrow
 *    it: a scope is the conjunction of its layers.
 *  - An entry naming no tool the turn has is ignored with one log line; a
 *    non-empty `tools` in which nothing resolves refuses the turn.
 *
 * Two Stigmer readings, each a trade-off stated once:
 *  - One engine tool can do the work of several Claude tools (Cursor's
 *    `edit` writes and edits; its `Delete` removes a file, which Claude does
 *    through Bash or Write). Such a tool is available when any Claude tool it
 *    covers is in scope and none is denied, so "never Write" also means "never
 *    delete" on Cursor.
 *  - An engine tool with no Claude name (Cursor's `readLints`, `askQuestion`,
 *    …) is the engine's, not the platform's: an allow-list hides it, because
 *    "only these" is exact; a deny-list leaves it alone.
 * The platform's own tools (`think`, and the synthesized channel,
 * conversation and memory attachments) are outside both lists: no plugin can
 * name them, and an agent without them cannot answer its channel.
 */

/** Claude Code's built-in tool names a list may carry. */
export type ClaudeTool =
  | "Bash"
  | "Read"
  | "Write"
  | "Edit"
  | "Glob"
  | "Grep"
  | "Agent"
  | "WebFetch"
  | "WebSearch"
  | "TodoWrite"
  | "NotebookEdit";

const CLAUDE_TOOLS: ReadonlySet<string> = new Set<ClaudeTool>([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "NotebookEdit",
]);

/** Claude Code's older spelling of `Agent`, still accepted there. */
const CLAUDE_ALIASES: ReadonlyMap<string, ClaudeTool> = new Map([["Task", "Agent"]]);

/**
 * The native engine's tool names and the Claude tools each covers. `delete`
 * is listed for completeness: the runner never binds it (file review needs
 * every removal to go through a reviewable write, `deepagents-profiles.ts`).
 */
export const NATIVE_TOOL_COVERS: ReadonlyMap<string, readonly ClaudeTool[]> = new Map([
  ["execute", ["Bash"]],
  ["read_file", ["Read"]],
  ["write_file", ["Write"]],
  ["edit_file", ["Edit"]],
  ["delete", ["Write"]],
  ["glob", ["Glob"]],
  ["ls", ["Glob"]],
  ["grep", ["Grep"]],
  ["task", ["Agent"]],
  ["web_fetch", ["WebFetch"]],
  ["write_todos", ["TodoWrite"]],
]);

/**
 * The names the Cursor `preToolUse` hook reports, and the Claude tools each
 * covers. The hook reports every file mutation, create or edit, as `Write`
 * (`tool-kind.ts`), so `Write` covers both.
 */
export const CURSOR_HOOK_TOOL_COVERS: ReadonlyMap<string, readonly ClaudeTool[]> = new Map([
  ["Shell", ["Bash"]],
  ["Read", ["Read"]],
  ["Write", ["Write", "Edit"]],
  ["StrReplace", ["Edit"]],
  ["Delete", ["Write"]],
  ["Glob", ["Glob"]],
  ["Grep", ["Grep"]],
  ["SemanticSearch", ["Grep"]],
  ["Task", ["Agent"]],
  ["WebFetch", ["WebFetch"]],
  ["WebSearch", ["WebSearch"]],
  ["updateTodos", ["TodoWrite"]],
  ["TodoWrite", ["TodoWrite"]],
  ["EditNotebook", ["NotebookEdit"]],
]);

/**
 * The `@cursor/sdk` `AgentOptions.tools` / `disallowedTools` vocabulary (its
 * `ToolName` literals, 1.0.31) and the Claude tools each covers. `mcp` is
 * absent on purpose: it is the whole MCP family, all-or-nothing, so MCP
 * narrowing is the hook's. A name with no Claude tool is an engine extra.
 */
export const CURSOR_SDK_TOOL_COVERS: ReadonlyMap<string, readonly ClaudeTool[]> = new Map([
  ["shell", ["Bash"]],
  ["read", ["Read"]],
  ["edit", ["Write", "Edit"]],
  ["delete", ["Write"]],
  ["glob", ["Glob"]],
  ["ls", ["Glob"]],
  ["grep", ["Grep"]],
  ["semSearch", ["Grep"]],
  ["task", ["Agent"]],
  ["webFetch", ["WebFetch"]],
  ["webSearch", ["WebSearch"]],
  ["updateTodos", ["TodoWrite"]],
  ["readTodos", ["TodoWrite"]],
]);

/** The SDK's built-in names with no Claude tool: hidden by an allow-list, left alone by a deny-list. */
export const CURSOR_SDK_EXTRA_TOOLS: readonly string[] = [
  "readLints",
  "askQuestion",
  "await",
  "generateImage",
  "applyAgentDiff",
];

/** Tools the platform owns on every engine; never governed by a list. */
export const PLATFORM_TOOLS: ReadonlySet<string> = new Set(["think"]);

/** One parsed list entry. */
export type ToolListEntry =
  | { readonly kind: "builtin"; readonly raw: string; readonly tool: ClaudeTool; readonly agentTypes: readonly string[] | null }
  | { readonly kind: "mcp"; readonly raw: string; readonly server: string | null; readonly tool: string | null }
  | { readonly kind: "unknown"; readonly raw: string };

const MCP_PREFIX = "mcp__";

/**
 * Parse one entry. The shape was checked at apply (the proto's item
 * pattern), so anything else here is a name this runner does not know.
 */
export function parseToolListEntry(raw: string): ToolListEntry {
  if (raw.startsWith(MCP_PREFIX)) {
    const rest = raw.slice(MCP_PREFIX.length);
    if (rest === "*") return { kind: "mcp", raw, server: null, tool: null };
    const sep = rest.indexOf("__");
    if (sep === -1) return rest === "" ? { kind: "unknown", raw } : { kind: "mcp", raw, server: rest, tool: null };
    const server = rest.slice(0, sep);
    const tool = rest.slice(sep + 2);
    if (server === "" || tool === "") return { kind: "unknown", raw };
    return { kind: "mcp", raw, server, tool: tool === "*" ? null : tool };
  }
  const open = raw.indexOf("(");
  const name = open === -1 ? raw : raw.slice(0, open);
  const specifier = open === -1 ? null : raw.slice(open + 1, raw.endsWith(")") ? -1 : undefined);
  const tool = CLAUDE_TOOLS.has(name) ? (name as ClaudeTool) : CLAUDE_ALIASES.get(name);
  if (!tool) return { kind: "unknown", raw };
  const agentTypes =
    tool === "Agent" && specifier !== null
      ? specifier.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t !== "")
      : null;
  return { kind: "builtin", raw, tool, agentTypes };
}

/** An agent's or sub-agent's lists as the blueprint carries them. */
export interface ToolLists {
  readonly tools: readonly string[];
  readonly disallowedTools: readonly string[];
}

/**
 * A name no list entry can carry. Asking about it answers for every server,
 * tool or sub-agent type no entry names, which all resolve alike: that is
 * what lets {@link ToolScope.mcpTable} and {@link ToolScope.subAgentTypeTable}
 * hand a whole scope to an evaluator as a finite table.
 */
const UNNAMED: unique symbol = Symbol("unnamed");
type Unnamed = typeof UNNAMED;

/** What a list entry is asked about. */
type Subject =
  | { readonly kind: "builtin"; readonly tool: ClaudeTool }
  | { readonly kind: "mcp"; readonly server: string | Unnamed; readonly tool: string | null | Unnamed };

/** One MCP server's answers in a {@link McpScopeTable}. */
export interface McpServerScope {
  /** In scope, per tool the turn knows of or an entry names. */
  readonly tools: Readonly<Record<string, boolean>>;
  /** The answer every other tool of this server shares. */
  readonly otherTools: boolean;
}

/** A scope's MCP answers as data ({@link ToolScope.mcpTable}). */
export interface McpScopeTable {
  /** Per server the turn has or an entry names. */
  readonly servers: Readonly<Record<string, McpServerScope>>;
  /** The answer every tool of any other server shares. */
  readonly otherServers: boolean;
}

/** A scope's `Agent(type, …)` answers as data ({@link ToolScope.subAgentTypeTable}). */
export interface SubAgentTypeTable {
  /** May the main agent start this type, per lowercased type known or named. */
  readonly types: Readonly<Record<string, boolean>>;
  /** The answer every other type shares. */
  readonly otherTypes: boolean;
}

function entryMatches(entry: ToolListEntry, subject: Subject): boolean {
  switch (entry.kind) {
    case "builtin":
      return subject.kind === "builtin" && subject.tool === entry.tool;
    case "mcp":
      if (subject.kind !== "mcp") return false;
      if (entry.server === null) return true;
      if (entry.server !== subject.server) return false;
      // A tool-level entry never matches a whole-server question: a server
      // is not "in scope" because one of its tools is.
      return entry.tool === null || entry.tool === subject.tool;
    case "unknown":
      return false;
    default: {
      const exhaustive: never = entry;
      throw new Error(`entryMatches: unknown entry ${String(exhaustive)}`);
    }
  }
}

/** One owner's lists, parsed. */
interface ScopeLayer {
  readonly owner: string;
  readonly tools: readonly ToolListEntry[];
  readonly disallowed: readonly ToolListEntry[];
}

function layerDenies(layer: ScopeLayer, subject: Subject): boolean {
  return layer.disallowed.some((e) => entryMatches(e, subject));
}

function layerAllows(layer: ScopeLayer, subject: Subject): boolean {
  if (layerDenies(layer, subject)) return false;
  return layer.tools.length === 0 || layer.tools.some((e) => entryMatches(e, subject));
}

/**
 * The resolved scope of one agent or sub-agent: its own layer over its
 * parent's. Immutable; {@link narrow} returns a new scope.
 */
export class ToolScope {
  /**
   * @param layers each owner's lists, the main agent's first when it has any
   * @param agentTypes the main agent's `Agent(type, …)` types, lower-cased;
   *   `null` when its lists name no type list. Fixed at {@link of} and carried
   *   unchanged by {@link narrow}: a sub-agent's type list is ignored, and a
   *   sub-agent's layer can be the first one when the main agent has no lists.
   */
  private constructor(
    private readonly layers: readonly ScopeLayer[],
    private readonly agentTypes: ReadonlySet<string> | null,
  ) {}

  /** No lists anywhere: every tool is in scope. */
  static unrestricted(): ToolScope {
    return new ToolScope([], null);
  }

  /** The main agent's scope. */
  static of(owner: string, lists: ToolLists): ToolScope {
    const scope = ToolScope.unrestricted().narrow(owner, lists);
    return new ToolScope(scope.layers, agentTypesOf(scope.layers[0]?.tools ?? []));
  }

  /** A sub-agent's scope: this one, narrowed by its own lists. */
  narrow(owner: string, lists: ToolLists): ToolScope {
    if (lists.tools.length === 0 && lists.disallowedTools.length === 0) return this;
    return new ToolScope(
      [
        ...this.layers,
        {
          owner,
          tools: lists.tools.map(parseToolListEntry),
          disallowed: lists.disallowedTools.map(parseToolListEntry),
        },
      ],
      this.agentTypes,
    );
  }

  /** True when any layer carries a list; an unrestricted scope needs no enforcement installed. */
  get restricted(): boolean {
    return this.layers.length > 0;
  }

  /** True when any layer carries a non-empty `tools`, which hides every engine extra. */
  get hasAllowList(): boolean {
    return this.layers.some((l) => l.tools.length > 0);
  }

  private allows(subject: Subject): boolean {
    return this.layers.every((l) => layerAllows(l, subject));
  }

  private denies(subject: Subject): boolean {
    return this.layers.some((l) => layerDenies(l, subject));
  }

  /** Whether a Claude built-in is in scope. */
  allowsClaudeTool(tool: ClaudeTool): boolean {
    return this.allows({ kind: "builtin", tool });
  }

  /**
   * Whether an engine tool that covers `covers` is in scope: some covered
   * Claude tool is, and none is denied. An empty `covers` is an engine extra.
   */
  allowsCovering(covers: readonly ClaudeTool[]): boolean {
    if (covers.length === 0) return !this.hasAllowList;
    if (covers.some((t) => this.denies({ kind: "builtin", tool: t }))) return false;
    return covers.some((t) => this.allowsClaudeTool(t));
  }

  /**
   * Whether an engine tool, named in its engine's table, is in scope. A
   * platform tool always is; a name the table does not carry is an engine
   * extra.
   */
  allowsEngineTool(name: string, table: ReadonlyMap<string, readonly ClaudeTool[]>): boolean {
    if (PLATFORM_TOOLS.has(name)) return true;
    return this.allowsCovering(table.get(name) ?? []);
  }

  /** Whether one MCP server's tool is in scope. */
  allowsMcpTool(server: string, tool: string): boolean {
    return this.allows({ kind: "mcp", server, tool });
  }

  /**
   * Whether some tool of one MCP server (or, for `null`, of any server) can
   * be in scope: no layer denies the server (or the whole family) outright,
   * and every layer with an allow-list names it at some level — the server,
   * one of its tools, or the family. A tool-level deny does not close the
   * family: other tools of the server may remain.
   */
  allowsMcpFamily(server: string | null): boolean {
    const deniesOutright = (e: ToolListEntry): boolean =>
      e.kind === "mcp" && e.tool === null && (e.server === null || e.server === server);
    const names = (e: ToolListEntry): boolean =>
      e.kind === "mcp" && (server === null || e.server === null || e.server === server);
    return this.layers.every(
      (l) => !l.disallowed.some(deniesOutright) && (l.tools.length === 0 || l.tools.some(names)),
    );
  }

  /**
   * Whether the main agent may start a sub-agent of `type`. Only the main
   * agent's `Agent(…)` type list counts: inside a sub-agent it is ignored.
   */
  allowsSubAgentType(type: string): boolean {
    return this.allowsType(type.toLowerCase());
  }

  private allowsType(type: string | Unnamed): boolean {
    if (!this.allowsClaudeTool("Agent")) return false;
    return this.agentTypes === null || (type !== UNNAMED && this.agentTypes.has(type));
  }

  /**
   * This scope's MCP answers as data, for an evaluator that cannot load this
   * module (the Cursor hook runs in a process of its own). `known` maps each
   * server the turn has to the tools it knows of. The table answers those and
   * every server and tool an entry names, plus the one answer every other
   * tool of a listed server shares and the one every tool of an unlisted
   * server shares, so a lookup in it equals {@link allowsMcpTool} for any
   * server and tool.
   */
  mcpTable(known: ReadonlyMap<string, readonly string[]>): McpScopeTable {
    const named = new Map<string, Set<string>>();
    const name = (server: string): Set<string> => {
      const tools = named.get(server) ?? new Set<string>();
      named.set(server, tools);
      return tools;
    };
    for (const [server, tools] of known) {
      const names = name(server);
      for (const tool of tools) names.add(tool);
    }
    for (const layer of this.layers) {
      for (const e of [...layer.tools, ...layer.disallowed]) {
        if (e.kind !== "mcp" || e.server === null) continue;
        const tools = name(e.server);
        if (e.tool !== null) tools.add(e.tool);
      }
    }
    const servers = Object.fromEntries(
      [...named].map(([server, tools]): [string, McpServerScope] => [
        server,
        {
          tools: Object.fromEntries([...tools].map((tool) => [tool, this.allowsMcpTool(server, tool)])),
          otherTools: this.allows({ kind: "mcp", server, tool: UNNAMED }),
        },
      ]),
    );
    return { servers, otherServers: this.allows({ kind: "mcp", server: UNNAMED, tool: UNNAMED }) };
  }

  /**
   * This scope's `Agent(type, …)` answers as data, for the same kind of
   * evaluator: every type in `known` and every type the main agent names,
   * plus the answer every other type shares. A lookup in it equals
   * {@link allowsSubAgentType}.
   */
  subAgentTypeTable(known: readonly string[]): SubAgentTypeTable {
    const types = new Set(known.map((t) => t.toLowerCase()));
    for (const t of this.agentTypes ?? []) types.add(t);
    return {
      types: Object.fromEntries([...types].map((t) => [t, this.allowsType(t)])),
      otherTypes: this.allowsType(UNNAMED),
    };
  }

  /** The lists in force, for the refusal a model reads: owner by owner. */
  describe(): string {
    return this.layers
      .map((l) => {
        const parts: string[] = [];
        if (l.tools.length > 0) parts.push(`tools [${l.tools.map((e) => e.raw).join(", ")}]`);
        if (l.disallowed.length > 0) parts.push(`disallowed_tools [${l.disallowed.map((e) => e.raw).join(", ")}]`);
        return `${l.owner}: ${parts.join(", ")}`;
      })
      .join("; ");
  }

  /** The newest layer's owner, the one a refusal names. */
  get owner(): string {
    return this.layers[this.layers.length - 1]?.owner ?? "";
  }

  /** The newest layer's entries, for the resolution check. */
  get ownEntries(): { readonly tools: readonly ToolListEntry[]; readonly disallowed: readonly ToolListEntry[] } {
    const l = this.layers[this.layers.length - 1];
    return { tools: l?.tools ?? [], disallowed: l?.disallowed ?? [] };
  }
}

/**
 * The sub-agent types a main agent's `tools` limits `Agent` to, or `null`
 * when it does not: no allow-list, or an `Agent` entry with no type list.
 */
function agentTypesOf(tools: readonly ToolListEntry[]): ReadonlySet<string> | null {
  if (tools.length === 0) return null;
  const types = new Set<string>();
  for (const e of tools) {
    if (e.kind !== "builtin" || e.tool !== "Agent") continue;
    if (e.agentTypes === null) return null;
    for (const t of e.agentTypes) types.add(t);
  }
  return types;
}

/** The message a model reads when it calls a tool its lists exclude. */
export function outOfScopeMessage(toolName: string, scope: ToolScope): string {
  return `Error: ${toolName} is not available to this agent. Its tool lists (${scope.describe()}) exclude it.`;
}

/** What one turn has, for deciding whether an entry names something. */
export interface TurnToolInventory {
  /** Claude tools the engine has at least one tool for. */
  readonly claudeTools: ReadonlySet<ClaudeTool>;
  /** Whether an MCP server (and, when known, one of its tools) is attached. */
  hasMcp(server: string, tool: string | null): boolean;
  /** Whether any MCP server is attached. */
  readonly anyMcp: boolean;
}

/** Thrown when a non-empty `tools` resolves to nothing: the turn is refused, as Claude refuses to launch such an agent. */
export class ToolListResolutionError extends Error {
  constructor(
    readonly owner: string,
    readonly entries: readonly string[],
  ) {
    super(
      `${owner}'s tools list names no tool this turn has: [${entries.join(", ")}]. ` +
        "Fix the list or remove it; an empty list means every tool.",
    );
    this.name = "ToolListResolutionError";
  }
}

function entryNamesSomething(entry: ToolListEntry, inventory: TurnToolInventory): boolean {
  switch (entry.kind) {
    case "builtin":
      return inventory.claudeTools.has(entry.tool);
    case "mcp":
      return entry.server === null ? inventory.anyMcp : inventory.hasMcp(entry.server, entry.tool);
    case "unknown":
      return false;
    default: {
      const exhaustive: never = entry;
      throw new Error(`entryNamesSomething: unknown entry ${String(exhaustive)}`);
    }
  }
}

function entryInScope(entry: ToolListEntry, scope: ToolScope): boolean {
  switch (entry.kind) {
    case "builtin":
      return scope.allowsClaudeTool(entry.tool);
    case "mcp":
      return entry.tool === null ? scope.allowsMcpFamily(entry.server) : scope.allowsMcpTool(entry.server ?? "", entry.tool);
    case "unknown":
      return false;
    default: {
      const exhaustive: never = entry;
      throw new Error(`entryInScope: unknown entry ${String(exhaustive)}`);
    }
  }
}

/**
 * Check the newest layer's entries against what the turn has: every entry
 * naming nothing is reported once through `log`, and a non-empty `tools`
 * none of whose entries names an in-scope tool throws
 * {@link ToolListResolutionError}.
 */
export function checkToolListResolution(
  scope: ToolScope,
  inventory: TurnToolInventory,
  log: (line: string) => void,
): void {
  const { tools, disallowed } = scope.ownEntries;
  for (const entry of [...tools, ...disallowed]) {
    if (!entryNamesSomething(entry, inventory)) {
      log(`${scope.owner}: tool list entry "${entry.raw}" names no tool this turn has; ignored`);
    }
  }
  if (tools.length === 0) return;
  const resolves = tools.some((e) => entryNamesSomething(e, inventory) && entryInScope(e, scope));
  if (!resolves) throw new ToolListResolutionError(scope.owner, tools.map((e) => e.raw));
}

/**
 * The Claude tools an engine has, from its name table and the names it
 * actually binds this turn.
 */
export function claudeToolsOf(
  boundNames: Iterable<string>,
  table: ReadonlyMap<string, readonly ClaudeTool[]>,
): Set<ClaudeTool> {
  const out = new Set<ClaudeTool>();
  for (const name of boundNames) for (const t of table.get(name) ?? []) out.add(t);
  return out;
}

/**
 * The Cursor main loop's built-in restriction, in the SDK's names, or
 * `undefined` for a field the SDK should not receive. `read` is never
 * hidden: the agent reads the platform's `.stigmer/` content through it, and
 * the hook confines it there when `Read` is excluded. `mcp` is never
 * removed: it is all-or-nothing, so MCP narrowing is the hook's.
 */
export function cursorSdkToolOptions(
  scope: ToolScope,
  anyMcp: boolean,
): { readonly tools?: string[]; readonly disallowedTools?: string[] } {
  if (!scope.restricted) return {};
  const denied: string[] = [];
  for (const [name, covers] of CURSOR_SDK_TOOL_COVERS) {
    if (name === "read") continue;
    if (!scope.allowsCovering(covers)) denied.push(name);
  }
  if (!scope.hasAllowList) return denied.length > 0 ? { disallowedTools: denied } : {};
  const allowed = ["read"];
  for (const [name, covers] of CURSOR_SDK_TOOL_COVERS) {
    if (name !== "read" && scope.allowsCovering(covers)) allowed.push(name);
  }
  if (anyMcp) allowed.push("mcp");
  return { tools: allowed };
}
