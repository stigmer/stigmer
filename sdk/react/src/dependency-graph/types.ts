/**
 * Resource kind in a dependency tree.
 *
 * - `"agent"` — the root agent (always the tree root)
 * - `"mcp-server"` — an MCP server referenced via `mcpServerUsages` or `mcpAccess`
 * - `"skill"` — a skill referenced via `skillRefs`
 * - `"sub-agent"` — an inline sub-agent definition with its own dependencies
 */
export type NodeKind = "agent" | "mcp-server" | "skill" | "sub-agent";

/**
 * A single node in the agent dependency tree.
 *
 * The tree is recursive: sub-agent nodes contain their own children
 * (MCP servers and skills they access). Edges are implicit in the
 * parent-child relationship — no separate edge type is needed.
 *
 * Nodes are navigable when `ref` is defined (MCP servers, skills).
 * Sub-agent nodes have no `ref` because they are inline definitions
 * within the agent spec, not standalone resources.
 */
export interface DependencyNode {
  /**
   * Deterministic identifier. Format: `{kind}:{slug}` for referenced
   * resources, `sub-agent:{name}` for sub-agents, or `agent:{slug}`
   * for the root.
   */
  readonly id: string;
  /** What kind of resource this node represents. */
  readonly kind: NodeKind;
  /** Primary display label (slug for resources, name for sub-agents). */
  readonly label: string;
  /**
   * Qualified label shown when the resource belongs to a different org
   * than the agent (e.g., `"other-org/shared-server"`). Undefined when
   * the resource is in the same org as the parent agent.
   */
  readonly qualifiedLabel?: string;
  /** Short description (sub-agent description, if available). */
  readonly description?: string;
  /**
   * Key-value metadata displayed as secondary info.
   * Examples: `{ tools: "3 tools" }`, `{ model: "gpt-4" }`.
   */
  readonly metadata?: Readonly<Record<string, string>>;
  /** Child nodes. Empty array for leaf nodes (MCP servers, skills). */
  readonly children: readonly DependencyNode[];
  /**
   * Navigation reference for clickable nodes. Defined for MCP servers
   * and skills (standalone resources). Undefined for sub-agents (inline
   * definitions) and the root agent.
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
   * where `ref` is defined (MCP servers, skills).
   */
  readonly onNodeClick?: (node: DependencyNode) => void;
  /**
   * Whether sub-agent subtrees start expanded.
   * @default true
   */
  readonly defaultExpanded?: boolean;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/** Options for {@link useDependencyGraph}. */
export interface UseDependencyGraphOptions {
  /** Display name of the agent (used as the root node label). */
  readonly agentName: string;
  /** Organization slug of the agent (used for cross-org label detection). */
  readonly agentOrg: string;
  /**
   * The agent's spec containing dependency references.
   * Pass `undefined` while the agent is loading — the hook returns
   * `null` for `tree` and `true` for `isEmpty`.
   */
  readonly spec: {
    readonly mcpServerUsages: readonly {
      readonly mcpServerRef?: {
        readonly org: string;
        readonly slug: string;
      };
      readonly enabledTools: readonly string[];
      readonly toolApprovalOverrides: readonly unknown[];
    }[];
    readonly skillRefs: readonly {
      readonly org: string;
      readonly slug: string;
    }[];
    readonly subAgents: readonly {
      readonly name: string;
      readonly description: string;
      readonly mcpAccess: readonly {
        readonly mcpServer: string;
        readonly enabledTools: readonly string[];
      }[];
      readonly skillRefs: readonly {
        readonly org: string;
        readonly slug: string;
      }[];
      readonly modelOverride: string;
    }[];
  } | undefined;
}

/** Return value of {@link useDependencyGraph}. */
export interface UseDependencyGraphReturn {
  /** The computed tree, or `null` when spec is undefined. */
  readonly tree: DependencyTree | null;
  /** `true` when the agent has zero dependencies (or spec is undefined). */
  readonly isEmpty: boolean;
}
