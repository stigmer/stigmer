/**
 * Resource kind in a dependency tree.
 *
 * - `"agent"` — the root agent (always the tree root)
 * - `"plugin"` — a plugin referenced via `plugins`
 * - `"mcp-server"` — an MCP server the agent writes itself (`mcpServers`), by its name
 * - `"skill"` — a skill referenced via `skillRefs`
 * - `"subagent"` — a saved agent referenced via `subagents`, at its pinned version
 */
export type NodeKind = "agent" | "plugin" | "mcp-server" | "skill" | "subagent";

/**
 * A single node in the agent dependency tree.
 *
 * The tree is rooted at the agent; each dependency is a leaf. A
 * subagent is an agent of its own, whose dependencies its own page
 * shows, so its node is a link rather than a subtree. Edges are
 * implicit in the parent-child relationship — no separate edge type
 * is needed.
 *
 * Nodes are navigable when `ref` is defined (plugins, skills and
 * subagents). A dependency deleted since it was attached has no `ref`
 * and is labelled "deleted <kind>". An MCP server the agent writes itself
 * is part of the agent, not a resource of its own, so it has no `ref`.
 */
export interface DependencyNode {
  /**
   * Deterministic identifier. Format: `{kind}:{slug}` for referenced
   * resources (`subagent:{slug}` for a listed agent), `{kind}:deleted:{index}`
   * for one deleted since it was attached, `mcp-server:{name}` for a server
   * the agent writes, or `agent:{slug}` for the root.
   */
  readonly id: string;
  /** What kind of resource this node represents. */
  readonly kind: NodeKind;
  /** Primary display label (the slug for referenced resources, the name for the root and an MCP server). */
  readonly label: string;
  /**
   * Qualified label shown when the resource belongs to a different org
   * than the agent (e.g., `"other-org/shared-server"`). Undefined when
   * the resource is in the same org as the parent agent.
   */
  readonly qualifiedLabel?: string;
  /** Short description, if available. */
  readonly description?: string;
  /**
   * Key-value metadata displayed as secondary info.
   * Examples: `{ tools: "3 tools" }`, `{ version: "1a2b3c4d" }`,
   * `{ host: "mcp.linear.app" }`.
   */
  readonly metadata?: Readonly<Record<string, string>>;
  /** Child nodes. Empty array for leaf nodes (plugins, MCP servers, skills, subagents). */
  readonly children: readonly DependencyNode[];
  /**
   * Navigation reference for clickable nodes. Defined for plugins,
   * skills and subagents (standalone resources). Undefined for the root
   * agent.
   */
  readonly ref?: { readonly org: string; readonly slug: string };
}

/**
 * Complete dependency tree for an agent, rooted at the agent itself.
 */
export interface DependencyTree {
  /** The agent node with all dependencies as descendants. */
  readonly root: DependencyNode;
  /** Total number of nodes in the tree (including root). */
  readonly nodeCount: number;
}

/** Props for {@link DependencyGraph}. */
export interface DependencyGraphProps {
  /** The dependency tree to render. */
  readonly tree: DependencyTree;
  /**
   * Called when a navigable node is clicked. The `node.ref` field
   * contains the `org` and `slug` for routing. Only fired for nodes
   * where `ref` is defined (plugins, skills and subagents).
   */
  readonly onNodeClick?: (node: DependencyNode) => void;
  /**
   * Whether collapsible subtrees start expanded.
   * @default true
   */
  readonly defaultExpanded?: boolean;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/** Options for {@link useDependencyGraph}. */
/**
 * A reference as the server returns it: its target's id and current slug.
 * A target deleted since it was attached comes back with an id and no
 * slug.
 */
export interface DependencyReference {
  readonly org: string;
  readonly slug: string;
  readonly id?: string;
}

export interface UseDependencyGraphOptions {
  /** Display name of the agent (used as the root node label). */
  readonly agentName: string;
  /** Id of the agent's organization, as its `metadata.org` stores it (compared with each reference's org for cross-org label detection). */
  readonly agentOrg: string;
  /**
   * The agent's spec containing dependency references.
   * Pass `undefined` while the agent is loading — the hook returns
   * `null` for `tree` and `true` for `isEmpty`.
   */
  readonly spec: {
    readonly plugins: readonly DependencyReference[];
    /** The MCP servers the agent writes itself; absent reads as none. */
    readonly mcpServers?: readonly { readonly name: string; readonly url: string }[];
    readonly skillRefs: readonly DependencyReference[];
    readonly subagents: readonly (DependencyReference & {
      /** The version hash the server pinned when the agent was saved. */
      readonly version: string;
    })[];
  } | undefined;
}

/** Return value of {@link useDependencyGraph}. */
export interface UseDependencyGraphReturn {
  /** The computed tree, or `null` when spec is undefined. */
  readonly tree: DependencyTree | null;
  /** `true` when the agent has zero dependencies (or spec is undefined). */
  readonly isEmpty: boolean;
}
