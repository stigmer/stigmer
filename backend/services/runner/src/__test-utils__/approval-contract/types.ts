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
 * A future substrate (e.g. the T04 TS server's runner) joins the safety net by
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
  /** MCP server slug — required for `kind: "mcp"`, ignored otherwise. */
  readonly mcpServerSlug?: string;
  /** MCP tool name — required for `kind: "mcp"`, ignored otherwise. */
  readonly mcpToolName?: string;
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
   * covered instead by the message-translator and corpus suites.
   */
  readonly surfacesGatePolicySource: boolean;
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
}
