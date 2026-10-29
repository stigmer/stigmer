/**
 * The names MCP tools reach a model under, on every engine, and the one way
 * back from such a name to the server and tool it stands for.
 *
 * A server's tool is `mcp__<server>__<tool>` to the model: Claude Code's
 * name, the vocabulary of agents' tool lists and Claude-Code-format hooks
 * (`shared/tool-lists.ts`), and the name the console and the API tell
 * people their tools have. The Claude engine's names are Claude Code's own;
 * the Stigmer engine sets each tool's name once, at connect
 * (`shared/mcp-manager.ts`), so two servers' tools of one name are two
 * tools and no server tool takes a built-in's name (stigmer#1860).
 *
 * The name is model-facing only. Every row, card, receipt, hook view, span
 * and record carries the bare tool beside its server, as it did when the
 * engine offered bare names: an engine resolves a name at its edges, through
 * {@link McpToolIndex}.
 *
 * Fitting. OpenAI documents a function name as `[a-zA-Z0-9_-]` of at most 64
 * characters (`openai` 6.38.0, `resources/shared.d.ts`), the one budget held
 * for every provider the Stigmer engine serves (the Anthropic SDK states
 * none). A server segment can be most of that: the shipped catalogue's
 * longest, `plugin_interactive-brokers_interactive-brokers`, leaves 11
 * characters for the tool. A canonical name past the budget is fitted by
 * {@link engineToolName}: the server segment is cut first, because the tool
 * is what the model reads, then the tool, and six hex characters of the
 * canonical name's hash are appended to the segment. A fitted name is a
 * function of the canonical one, so it is the same on every turn of a
 * session, and two names that cut alike differ by their hash.
 *
 * Never parsed. A tool name may itself contain `__`, and a fitted name
 * carries no full server. The index is built from what each server listed,
 * as the Claude bridge's owners were, and refuses two tools that would take
 * one name ({@link McpToolNameCollisionError}). Two canonical names cannot
 * meet, since server slugs are unique in a turn and none contains `__`
 * (`harness/turn-context.ts`, `backend/libs/ts/plugin-package/src/tool-names.ts`);
 * a fitted name can, only with another fitted name's hash or with the
 * canonical name of a server whose slug is its cut segment and hash.
 */

import { createHash } from "node:crypto";

/** The longest tool name the engine sends a provider (the header). */
export const ENGINE_TOOL_NAME_MAX = 64;

const PREFIX = "mcp__";
const SEPARATOR = "__";
const HASH_CHARS = 6;
/** The least of a server segment a fitted name keeps, when its tool is long. */
const MIN_SEGMENT = 8;

/** Claude Code's name for a server's tool. */
export function mcpToolName(slug: string, tool: string): string {
  return `${PREFIX}${slug}${SEPARATOR}${tool}`;
}

/** The name the model is offered a server's tool under: {@link mcpToolName}, fitted to {@link ENGINE_TOOL_NAME_MAX} (the header). */
export function engineToolName(slug: string, tool: string): string {
  const canonical = mcpToolName(slug, tool);
  if (canonical.length <= ENGINE_TOOL_NAME_MAX) return canonical;
  const mark = `_${createHash("sha256").update(canonical).digest("hex").slice(0, HASH_CHARS)}`;
  const room = ENGINE_TOOL_NAME_MAX - PREFIX.length - mark.length - SEPARATOR.length;
  const kept = Math.min(slug.length, Math.max(MIN_SEGMENT, room - tool.length));
  // A cut that ends on a separator character would double the `_` before the hash.
  const segment = slug.slice(0, kept).replace(/[_-]+$/, "");
  return `${PREFIX}${segment}${mark}${SEPARATOR}${tool.slice(0, room - kept)}`;
}

/** The server and tool an engine name stands for. */
export interface McpToolOwner {
  readonly slug: string;
  readonly tool: string;
}

/** Two of a turn's tools would reach the model under one name; the turn cannot offer them both. */
export class McpToolNameCollisionError extends Error {
  constructor(name: string, first: McpToolOwner, second: McpToolOwner) {
    super(
      `two MCP tools of this turn would both reach the model as '${name}' ` +
      `(tool '${first.tool}' of server '${first.slug}' and tool '${second.tool}' of server '${second.slug}'); remove or rename one of them`,
    );
    this.name = "McpToolNameCollisionError";
  }
}

/** One server's listed tools, by their own names. */
export interface ListedServerTools {
  readonly slug: string;
  readonly tools: Iterable<string>;
}

/** Each listed tool's engine name, and each engine name's server and tool (the header). */
export class McpToolIndex {
  static readonly EMPTY = new McpToolIndex(new Map(), new Map());

  /**
   * The index over what `servers` listed, each tool named by `nameOf`:
   * {@link engineToolName} on the Stigmer engine, which names its tools;
   * {@link mcpToolName} on the Claude engine, whose names Claude Code builds
   * and never fits. Throws {@link McpToolNameCollisionError}.
   */
  static of(servers: Iterable<ListedServerTools>, nameOf: (slug: string, tool: string) => string = engineToolName): McpToolIndex {
    const owners = new Map<string, McpToolOwner>();
    const names = new Map<string, Map<string, string>>();
    for (const { slug, tools } of servers) {
      const byTool = names.get(slug) ?? new Map<string, string>();
      names.set(slug, byTool);
      for (const tool of tools) {
        if (byTool.has(tool)) continue;
        const name = nameOf(slug, tool);
        const holder = owners.get(name);
        if (holder !== undefined) throw new McpToolNameCollisionError(name, holder, { slug, tool });
        owners.set(name, { slug, tool });
        byTool.set(tool, name);
      }
    }
    return new McpToolIndex(owners, names);
  }

  private constructor(
    private readonly owners: ReadonlyMap<string, McpToolOwner>,
    private readonly names: ReadonlyMap<string, ReadonlyMap<string, string>>,
  ) {}

  /** The name server `slug`'s `tool` reaches the model under; undefined for a tool it never listed. */
  engineName(slug: string, tool: string): string | undefined {
    return this.names.get(slug)?.get(tool);
  }

  /** The server and tool an engine name stands for; undefined for a built-in, or any name no server listed. */
  ownerOf(engineName: string): McpToolOwner | undefined {
    return this.owners.get(engineName);
  }

  /** The bare tool an engine name stands for: its server's listed name, or the name itself for a built-in. */
  toolOf(engineName: string): string {
    return this.owners.get(engineName)?.tool ?? engineName;
  }

  /** Every engine name, in listing order. */
  engineNames(): IterableIterator<string> {
    return this.owners.keys();
  }
}
