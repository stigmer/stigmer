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

/** What a list entry is asked about. */
type Subject =
  | { readonly kind: "builtin"; readonly tool: ClaudeTool }
  | { readonly kind: "mcp"; readonly server: string; readonly tool: string | null };

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
  private constructor(private readonly layers: readonly ScopeLayer[]) {}

  /** No lists anywhere: every tool is in scope. */
  static unrestricted(): ToolScope {
    return new ToolScope([]);
  }

  /** The main agent's scope. */
  static of(owner: string, lists: ToolLists): ToolScope {
    return ToolScope.unrestricted().narrow(owner, lists);
  }

  /** A sub-agent's scope: this one, narrowed by its own lists. */
  narrow(owner: string, lists: ToolLists): ToolScope {
    if (lists.tools.length === 0 && lists.disallowedTools.length === 0) return this;
    return new ToolScope([
      ...this.layers,
      {
        owner,
        tools: lists.tools.map(parseToolListEntry),
        disallowed: lists.disallowedTools.map(parseToolListEntry),
      },
    ]);
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
   * Whether a whole MCP server (or, for `null`, the whole MCP family) is
   * in scope as a family: not denied outright, and named by a server- or
   * family-level entry wherever an allow-list exists.
   */
  allowsMcpFamily(server: string | null): boolean {
    if (server !== null) return this.allows({ kind: "mcp", server, tool: null });
    return !this.layers.some((l) => l.disallowed.some((e) => e.kind === "mcp" && e.server === null));
  }

  /**
   * Whether the main agent may start a sub-agent of `type`. Only the first
   * layer's `Agent(…)` type list counts: inside a sub-agent it is ignored.
   */
  allowsSubAgentType(type: string): boolean {
    if (!this.allowsClaudeTool("Agent")) return false;
    const root = this.layers[0];
    if (!root || root.tools.length === 0) return true;
    let types: Set<string> | null = new Set();
    for (const e of root.tools) {
      if (e.kind !== "builtin" || e.tool !== "Agent") continue;
      if (e.agentTypes === null) {
        types = null;
        break;
      }
      for (const t of e.agentTypes) types.add(t);
    }
    return types === null || types.has(type.toLowerCase());
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
