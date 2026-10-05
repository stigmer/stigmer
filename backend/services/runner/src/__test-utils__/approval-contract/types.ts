/**
 * The substrate-agnostic seam for the HITL gateway Contract Test Kit.
 *
 * Stigmer enforces tool approval through two real substrates with very different
 * mechanics:
 * - the in-process deep-agent gate (a LangGraph middleware that IS the side
 *   effect), and
 * - the out-of-process Cursor deny-oracle (a bash preToolUse hook that allows or
 *   denies a tool the agent runs inside cursor-agent).
 *
 * The safety invariants they must uphold are identical, so the contract describes
 * them once and runs them against anything that implements {@link GatewaySubstrate}.
 * A future substrate (another runner, say) joins the safety net by
 * implementing this one interface — it does not get to redefine the invariants.
 *
 * This seam intentionally does NOT carry raw, harness-specific tool names. The
 * two substrates name the same operation differently (the Cursor hook says
 * `Write`/`Shell`/`Delete`; the deep-agent stream says `edit`/`shell`/`delete`),
 * so the contract speaks in the abstract {@link ProposedAction} and each adapter
 * translates it into its own taxonomy. Keeping the contract taxonomy-free is what
 * makes "both substrates agree on the same logical action" a meaningful assertion.
 */

/**
 * A logical action a model proposes, expressed independently of any harness
 * taxonomy. Each adapter maps it to its substrate's concrete tool name and args.
 */
export interface ProposedAction {
  /**
   * The action's approval-relevant kind. `write`/`shell`/`delete` are the gated
   * mutating categories; `read` is any non-mutating built-in; `mcp` is an
   * MCP-server tool.
   */
  readonly kind: "write" | "shell" | "delete" | "read" | "mcp";
  /**
   * The resource the action acts on — the absolute file path for file actions,
   * the command string for shell. Empty for `mcp` (MCP identity is name-scoped).
   * This is the "salient" value the exact-resource lease binds to.
   */
  readonly resource: string;
  /**
   * The edit content for a `write` action — the body whose digest the
   * content-exact grant binds to. Two `write`s to the same `resource` with
   * DIFFERENT `content` are distinct identities (the sibling-isolation probe);
   * omitted, a substrate uses a fixed placeholder. Ignored for non-write kinds.
   */
  readonly content?: string;
  /** MCP server slug — required for `kind: "mcp"`, ignored otherwise. */
  readonly mcpServerSlug?: string;
  /** MCP tool name — required for `kind: "mcp"`, ignored otherwise. */
  readonly mcpToolName?: string;
  /**
   * For `kind: "mcp"`: the tool's server marks it destructive
   * (`DiscoveredTool.destructive_hint`), so the approval default asks.
   */
  readonly mcpDestructive?: boolean;
  /**
   * For `kind: "read"`: `resource` is a path under the platform's own content
   * (the `.stigmer/` route that carries the agent's skills, inputs and plan),
   * which each adapter places where its engine mounts it.
   */
  readonly platformContent?: boolean;
}

/** An agent's (or sub-agent's) two tool lists, in Claude Code's names. */
export interface ContractToolLists {
  readonly tools: readonly string[];
  readonly disallowedTools: readonly string[];
}

/** How a lists drive runs the action. */
export interface ListsDriveOptions {
  /** The pre-armed "trust this whole run": the approval gate is absent. */
  readonly autoApproveAll?: boolean;
  /**
   * Run the action inside a sub-agent carrying these lists, narrowed from the
   * agent's. Driven only where {@link SubstrateCapabilities.enforcesSubAgentLists}.
   */
  readonly subAgent?: ContractToolLists;
}

/** The outcome of a lists drive: a {@link GatewayOutcome} plus whether the lists refused the call. */
export interface ListsOutcome extends GatewayOutcome {
  /**
   * The agent's lists refused the call: it did not run, the model read the
   * out-of-scope message, and no approval was asked.
   */
  readonly refused: boolean;
}

/**
 * The decision applied to a proposed action.
 * - `none`   — no decision yet: run the action up to the gate and stop (the
 *              "what happens with no backing authorization" probe).
 * - `approve`— authorize THIS action.
 * - `skip` / `reject` / `unknown` — every non-approving outcome; none may execute.
 */
export type GatewayDecision = "none" | "approve" | "skip" | "reject" | "unknown";

/**
 * The observable result of putting one proposed action through a substrate.
 */
export interface GatewayOutcome {
  /**
   * Whether the side effect ran (or, for an out-of-process substrate, whether
   * the substrate ALLOWED it to run). This is the safety-critical observable and
   * is comparable across substrates.
   */
  readonly executed: boolean;
  /**
   * Whether the substrate withheld the action pending approval. Note the precise
   * meaning is substrate-specific (the in-process gate "paused at an interrupt";
   * the deny-oracle "denied this call"), so it is only compared across substrates
   * for `none`-decision probes, where both mean "withheld".
   */
  readonly gated: boolean;
  /**
   * Exact number of times the side effect ran. Populated only when
   * {@link SubstrateCapabilities.observesExecution} is true (an in-process
   * substrate can count; an out-of-process one cannot observe execution at all).
   */
  readonly executionCount?: number;
  /**
   * The authorization provenance the gate attached when it withheld the action —
   * the PolicySource union string (e.g. "builtin_category", "agent_override").
   * Populated only when {@link SubstrateCapabilities.surfacesGatePolicySource} is
   * true; empty/undefined otherwise. Lets the contract assert every gated side
   * effect is provenance-tagged.
   */
  readonly policySource?: string;
}

/**
 * Capability flags for invariants that legitimately differ by substrate, gated
 * rather than forked — mirroring the conformance suite's `CapabilityFlags`.
 */
export interface SubstrateCapabilities {
  /**
   * True when the runner executes the tool in-process and can therefore observe
   * (and count) the side effect directly. The deep-agent gate is in-process
   * (`true`); the Cursor hook authorizes a tool that runs in another process
   * (`false`, receipts are best-effort).
   */
  readonly observesExecution: boolean;
  /**
   * True when an approval is bound to the exact resource it was granted for, so
   * approving one resource never authorizes another. The Cursor grant token binds
   * the resource (`true`); the deep-agent gate re-checks every distinct call and
   * relies on checkpoint replay for sameness, so per-resource lease isolation is
   * not a property of that gate (`false`).
   */
  readonly enforcesExactResource: boolean;
  /**
   * True when an approval is bound to the exact CONTENT of the action, not just
   * its resource — so approving one edit to a file never authorizes a DIFFERENT
   * edit to the SAME file. The Cursor grant binds (category, path, contentDigest)
   * (`true`); the deep-agent gate relies on checkpoint replay for sameness, so
   * content isolation is not a property of that gate (`false`).
   */
  readonly enforcesExactContent: boolean;
  /**
   * True when the substrate honors a run-lifetime CLASS lease: an APPROVE_ALL on
   * one action auto-approves later actions of the SAME class (built-in category)
   * for the rest of the run, while a DIFFERENT class stays gated. Both production
   * substrates enforce this (the deep-agent gate clears leased categories; the
   * Cursor hook reads `leasedCategories` from its state file), so both set `true`
   * and implement {@link GatewaySubstrate.authorizeUnderClassLease}.
   */
  readonly appliesRunLifetimeLease: boolean;
  /**
   * True when the substrate attaches authorization provenance
   * (approval_policy_source) at the gate, so a withheld action's
   * {@link GatewayOutcome.policySource} is populated. The deep-agent gate decides
   * and stamps the source at interrupt time (`true`); the Cursor substrate's
   * provenance is a reconstruction-time projection over the persisted tool call,
   * not a property of the hook's deny decision, so it is `false` here and is
   * covered instead by the translator, boundary-rows and corpus suites.
   */
  readonly surfacesGatePolicySource: boolean;
  /**
   * True when the substrate runs an agent's hooks, in either format, at its
   * gate; the contract's hooks section runs only there. Both engines do: the
   * native gate in process, the Cursor gate through the runner's hook server.
   */
  readonly runsHooks: boolean;
  /**
   * True when a hook can tell a sub-agent's call from the main agent's (its
   * stdin carries `agent_id` and `agent_type`). The native gate knows which
   * sub-agent graph made a call (`true`); Cursor's hook payload carries no
   * sub-agent identity (live probe, 2026-10-05), so the Cursor engine's
   * hooks run on a sub-agent's calls without it (`false`).
   */
  readonly hookSeesSubAgent: boolean;
  /**
   * True when a sub-agent's own tool lists are enforced inside the sub-agent.
   * The native engine narrows each sub-agent graph (`true`); the Cursor hook
   * cannot tell which sub-agent is calling, so the Cursor engine refuses a
   * turn whose sub-agent carries lists at setup instead (`false`, pinned by
   * that harness's own tests).
   */
  readonly enforcesSubAgentLists: boolean;
}

/**
 * A real enforcement substrate, wired to its production code. Adapters translate
 * abstract actions/decisions into substrate-specific drives and report a uniform
 * {@link GatewayOutcome}; they never reimplement enforcement logic.
 */
export interface GatewaySubstrate {
  /** Stable substrate name, used in suite titles and diagnostics. */
  readonly name: string;
  /** Honest per-substrate capability flags. */
  readonly capabilities: SubstrateCapabilities;
  /**
   * Whether this substrate can run in the current environment (e.g. the Cursor
   * deny-oracle needs `bash`). The contract skips its suite when `false`.
   */
  readonly available: boolean;
  /**
   * Put a single proposed action through the substrate under a decision and
   * report what happened.
   */
  authorize(action: ProposedAction, decision: GatewayDecision): Promise<GatewayOutcome>;
  /**
   * Approve `granted`, then probe `probe` against that standing authorization —
   * the lease-isolation drive. Implemented only when
   * {@link SubstrateCapabilities.enforcesExactResource} is true.
   */
  authorizeAfterGrant?(granted: ProposedAction, probe: ProposedAction): Promise<GatewayOutcome>;
  /**
   * Grant a run-lifetime CLASS lease by choosing APPROVE_ALL on `leased`, then
   * probe `probe` against that standing lease — the scoped-lease drive that
   * proves "approving all of class A never auto-approves class B." `leased` must
   * be a gated built-in (write/shell/delete). Implemented only when
   * {@link SubstrateCapabilities.appliesRunLifetimeLease} is true.
   */
  authorizeUnderClassLease?(leased: ProposedAction, probe: ProposedAction): Promise<GatewayOutcome>;
  /**
   * Put one action through an agent carrying `lists`, with no approval
   * decision (`none`), and report whether the lists refused it, the default
   * gated it, or it ran.
   */
  authorizeUnderLists(lists: ContractToolLists, action: ProposedAction, options?: ListsDriveOptions): Promise<ListsOutcome>;
  /**
   * Put one action through an agent carrying `hooks` and report what the
   * hooks and the gate made of it. Implemented only when
   * {@link SubstrateCapabilities.runsHooks} is true.
   */
  authorizeUnderHooks?(hooks: readonly ContractHook[], action: ProposedAction, options?: HooksDriveOptions): Promise<HooksOutcome>;
}

/** What a contract hook's command does when it runs. */
export type ContractHookBehaviour =
  /** Answer with Claude Code's JSON: a decision, its reason, a rewritten action, and context for the model. */
  | {
      readonly answer: "allow" | "deny" | "ask";
      readonly reason?: string;
      /** Rewrite the call into this action (`updatedInput`). */
      readonly rewrite?: ProposedAction;
      readonly context?: string;
    }
  /** Ask on its first run and deny on every later one: the resume probe. */
  | { readonly answer: "ask-then-deny" }
  /** Exit with this code, writing `stderr`. */
  | { readonly exit: number; readonly stderr?: string }
  /** Never answer: outlive the hook's timeout. */
  | { readonly hang: true }
  /** A PostToolUse hook that blocks on the result with this reason, beside optional context. */
  | { readonly postBlock: string; readonly context?: string }
  /** Print something that is not JSON and exit 0. */
  | { readonly invalidJson: true };

/** One command hook, in Claude Code's format or Cursor's. */
export interface ContractHook {
  /** Claude Code's `PreToolUse`/`PostToolUse`, or one of Cursor's tool events. */
  readonly event: "PreToolUse" | "PostToolUse" | "preToolUse" | "beforeShellExecution" | "beforeMCPExecution" | "postToolUse";
  /** The matcher: Claude Code's (`Bash`, `mcp__srv__search_issues`) or Cursor's (`Shell`, `MCP:search_issues`, a command pattern). */
  readonly matcher: string;
  /** The handler's `if` (Claude Code's format only). */
  readonly condition?: string;
  readonly does: ContractHookBehaviour;
  /** The plugin the hook comes from; `""` is the agent's own hooks block. Default `safety`. */
  readonly plugin?: string;
  /** The format the hook is written in; Claude Code's when absent. */
  readonly format?: "claude-code" | "cursor";
  /** Cursor's `failClosed`: a run that fails refuses the call. */
  readonly failClosed?: boolean;
}

/** How a hooks drive runs the action. */
export interface HooksDriveOptions {
  /** The decision a card gets, if one shows; default `none`. */
  readonly decision?: GatewayDecision;
  /** The pre-armed "trust this whole run". */
  readonly autoApproveAll?: boolean;
  /** The unattended approval mode: an ask resolves as a skip. */
  readonly unattended?: boolean;
  /** A held hook lease: `plugin`'s asks on `action`'s tool count as its allow. */
  readonly hookLease?: { readonly plugin: string; readonly action: ProposedAction };
  /** A held category lease. */
  readonly categoryLease?: "write" | "shell";
  /** Make the call inside a sub-agent of this type. */
  readonly subAgent?: string;
  /** The agent's tool lists, ahead of the hooks. */
  readonly lists?: ContractToolLists;
  /** The tool itself fails when it runs. */
  readonly failTool?: boolean;
}

/** The outcome of a hooks drive. */
export interface HooksOutcome extends GatewayOutcome {
  /** Who refused the call, if anyone: a hook's deny, or the agent's tool lists. */
  readonly refusedBy: "hook" | "lists" | undefined;
  /** The plugin a withheld call's card names; undefined when no hook asked. */
  readonly policyHook?: string;
  /** What the model read back for the call. */
  readonly modelRead: string;
  /** What each hook run read on stdin, in run order. */
  readonly hookRuns: readonly Record<string, unknown>[];
  /** The files a write created, by the action's resource. */
  readonly writtenPaths: readonly string[];
}
