/**
 * An agent's two tool lists — `tools` ("only these") and `disallowed_tools`
 * ("never these") — in Claude Code's vocabulary, resolved the way Claude Code
 * resolves a sub-agent's lists, for both engines. A turn may carry the same
 * two lists (`RunSpec.tools`, `RunSpec.disallowed_tools`), which narrow its
 * agent's (or the assistant's) for that turn only.
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
 *    may start; inside a sub-agent the type list is ignored. Types compare in
 *    one normalized form ({@link normalizeSubAgentType}), so Claude's
 *    `general-purpose` and Cursor's `generalPurpose` are one type.
 *  - A sub-agent starts from its parent's resolved set and can only narrow
 *    it: a scope is the conjunction of its layers. A turn's lists are one
 *    more layer over the agent's ({@link ToolScope.ofMain}), so a turn can
 *    narrow and never widen; their `Agent(type, …)` lists intersect.
 *  - An entry naming no tool the turn has is ignored with one log line; a
 *    non-empty `tools` in which nothing resolves refuses the turn.
 *
 * Three Stigmer readings, each a trade-off stated once:
 *  - One engine tool can do the work of several Claude tools (Cursor's
 *    `edit` writes and edits; its `Delete` removes a file, which Claude does
 *    through Bash or Write). Such a tool is available when any Claude tool it
 *    covers is in scope and none is denied, so "never Write" also means "never
 *    delete" on Cursor.
 *  - An engine tool with no Claude name (Cursor's `readLints`, `askQuestion`,
 *    …) is the engine's, not the platform's: an allow-list hides it, because
 *    "only these" is exact; a deny-list leaves it alone.
 *  - `Skill` names no engine tool: both engines activate a skill by reading
 *    its `SKILL.md`. Denied by any layer, it hides skills: the turn's prompt
 *    lists none and a read of a skill's files is refused
 *    ({@link ToolScope.hidesSkills}). An allow-list that omits it keeps them,
 *    because skills are platform content, as the confined read already
 *    treats them, so no stored agent changes behaviour. An entry naming it
 *    always names something, the way a platform capability does, and is in
 *    scope unless a layer denies it: a turn or sub-agent `tools: [Skill]`
 *    under an agent's `tools: [Read]` resolves, since that agent keeps its
 *    skills.
 * The platform's own tools (the synthesized channel, conversation and memory
 * attachments) are outside both lists: no plugin can name them, and an agent
 * without them cannot answer its channel.
 */

import { CLAUDE_TOOL_ALIASES, CURSOR_SDK_TOOL_COVERS, isClaudeTool, type ClaudeTool } from "@stigmer/tool-vocabulary";

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
  const tool = isClaudeTool(name) ? name : CLAUDE_TOOL_ALIASES.get(name);
  if (!tool) return { kind: "unknown", raw };
  const agentTypes =
    tool === "Agent" && specifier !== null
      ? specifier.split(",").map((t) => normalizeSubAgentType(t.trim())).filter((t) => t !== "")
      : null;
  return { kind: "builtin", raw, tool, agentTypes };
}

/**
 * A sub-agent type in the one form both sides of an `Agent(type, …)`
 * comparison take: lower-cased, with `-` and `_` dropped. The engines spell
 * one built-in type differently (Claude Code and the native engine
 * `general-purpose`, Cursor's `subagent_type` `generalPurpose`), and a list
 * must mean the same on both. Self-contained on purpose: the Cursor hook
 * embeds this function's own source (`hook-script.ts`), so it references
 * nothing outside itself.
 */
export function normalizeSubAgentType(type: string): string {
  return type.toLowerCase().replace(/[-_]/g, "");
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
  /** May the main agent start this type, per normalized type known or named ({@link normalizeSubAgentType}). */
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
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no entry kind reaches it */
    default: {
      const exhaustive: never = entry;
      throw new Error(`entryMatches: unknown entry ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
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
   *   (the agent's, then the turn's)
   * @param agentTypes the main agent's `Agent(type, …)` types, normalized
   *   ({@link normalizeSubAgentType});
   *   `null` when its lists name no type list. Fixed at {@link ofMain} and
   *   carried unchanged by {@link narrow}: a sub-agent's type list is
   *   ignored, and a sub-agent's layer can be the first one when the main
   *   agent has no lists.
   */
  private constructor(
    private readonly layers: readonly ScopeLayer[],
    private readonly agentTypes: ReadonlySet<string> | null,
  ) {}

  /** No lists anywhere: every tool is in scope. */
  static unrestricted(): ToolScope {
    return new ToolScope([], null);
  }

  /** The main agent's scope, from one owner's lists. */
  static of(owner: string, lists: ToolLists): ToolScope {
    return ToolScope.ofMain([{ owner, lists }]);
  }

  /**
   * The main agent's scope from several owners' lists, outermost first (the
   * agent's, then the turn's): each narrows the ones before it, and the
   * `Agent(type, …)` limit is the intersection of every owner's type list.
   * An owner with empty lists adds no layer.
   */
  static ofMain(owners: readonly { readonly owner: string; readonly lists: ToolLists }[]): ToolScope {
    let scope = ToolScope.unrestricted();
    for (const { owner, lists } of owners) scope = scope.narrow(owner, lists);
    const limits = scope.layers.flatMap((layer) => {
      const own = agentTypesOf(layer.tools);
      return own === null ? [] : [own];
    });
    const [first, ...rest] = limits;
    const types = first === undefined ? null : new Set([...first].filter((t) => rest.every((l) => l.has(t))));
    return new ToolScope(scope.layers, types);
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

  /**
   * True when any layer denies `Skill`: the turn's prompt lists no skills
   * and a read of a skill's files is refused. An allow-list that omits
   * `Skill` does not hide them (the module header's third reading).
   */
  get hidesSkills(): boolean {
    return this.denies({ kind: "builtin", tool: "Skill" });
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
   * Whether an engine tool, named in its engine's table, is in scope. A name
   * the table does not carry is an engine extra.
   */
  allowsEngineTool(name: string, table: ReadonlyMap<string, readonly ClaudeTool[]>): boolean {
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
    return this.allowsType(normalizeSubAgentType(type));
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
    const types = new Set(known.map(normalizeSubAgentType));
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

  /** How many owners' lists this scope holds. */
  get depth(): number {
    return this.layers.length;
  }

  /**
   * The scope of this one's first `count` layers: what the layer after them
   * narrows. Each layer of a main scope is checked against its own prefix
   * ({@link checkMainToolListResolution}), so a turn's narrower list never
   * makes the agent's own list look unresolvable.
   */
  upTo(count: number): ToolScope {
    return new ToolScope(this.layers.slice(0, count), this.agentTypes);
  }

  /**
   * This scope as plain data, for the agent host (`agent-host/codec.ts`):
   * every layer's raw entries and the main agent's type list, which is all
   * the state a scope has. {@link fromWire} rebuilds an equal scope; the
   * entries are re-parsed there, so a parse rule lives once.
   */
  toWire(): ToolScopeWire {
    return {
      layers: this.layers.map((l) => ({
        owner: l.owner,
        tools: l.tools.map((e) => e.raw),
        disallowedTools: l.disallowed.map((e) => e.raw),
      })),
      agentTypes: this.agentTypes === null ? null : [...this.agentTypes],
    };
  }

  /** The scope {@link toWire} described. */
  static fromWire(wire: ToolScopeWire): ToolScope {
    return new ToolScope(
      wire.layers.map((l) => ({
        owner: l.owner,
        tools: l.tools.map(parseToolListEntry),
        disallowed: l.disallowedTools.map(parseToolListEntry),
      })),
      wire.agentTypes === null ? null : new Set(wire.agentTypes),
    );
  }
}

/** A {@link ToolScope} as plain data: its layers' raw lists and the main agent's normalized type list. */
export interface ToolScopeWire {
  readonly layers: readonly { readonly owner: string; readonly tools: readonly string[]; readonly disallowedTools: readonly string[] }[];
  readonly agentTypes: readonly string[] | null;
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
      // Skills are the platform's, on every turn (the header's third reading).
      return entry.tool === "Skill" || inventory.claudeTools.has(entry.tool);
    case "mcp":
      return entry.server === null ? inventory.anyMcp : inventory.hasMcp(entry.server, entry.tool);
    case "unknown":
      return false;
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no entry kind reaches it */
    default: {
      const exhaustive: never = entry;
      throw new Error(`entryNamesSomething: unknown entry ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

function entryInScope(entry: ToolListEntry, scope: ToolScope): boolean {
  switch (entry.kind) {
    case "builtin":
      // An allow-list that omits Skill keeps skills, so only a deny takes it out of scope.
      return entry.tool === "Skill" ? !scope.hidesSkills : scope.allowsClaudeTool(entry.tool);
    case "mcp":
      return entry.tool === null ? scope.allowsMcpFamily(entry.server) : scope.allowsMcpTool(entry.server ?? "", entry.tool);
    /* v8 ignore start -- @preserve: checkToolListResolution asks only an entry that names something, which an unknown one never does */
    case "unknown":
      return false;
    /* v8 ignore stop */
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no entry kind reaches it */
    default: {
      const exhaustive: never = entry;
      throw new Error(`entryInScope: unknown entry ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
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
 * {@link checkToolListResolution} for every layer of a main scope, outermost
 * first, each against the layers before it and itself: the agent's lists
 * are judged as the agent's, then the turn's over them, so a turn whose
 * `tools` resolves to nothing the agent leaves it is refused in the turn's
 * name.
 */
export function checkMainToolListResolution(
  scope: ToolScope,
  inventory: TurnToolInventory,
  log: (line: string) => void,
): void {
  for (let count = 1; count <= scope.depth; count++) checkToolListResolution(scope.upTo(count), inventory, log);
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
