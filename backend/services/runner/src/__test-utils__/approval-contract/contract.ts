/**
 * The HITL gateway P0 safety contract — the single authoritative statement of
 * "these are THE tool-approval safety invariants, and every enforcement
 * substrate must satisfy them."
 *
 * {@link describeGatewayContract} runs the invariants below against any
 * {@link GatewaySubstrate}; {@link describeCrossSubstrateAgreement} proves the
 * substrates reach the SAME decision for the SAME logical action. Both drive real
 * production code through thin adapters, so reverting any P0 behavior fails here.
 *
 * ── Canonical P0 invariant catalog ──────────────────────────────────────────
 *  1. No side effect without a backing authorization (the umbrella the rest serve).
 *  2. approve            → executes exactly once (count asserted where observable).
 *  3. reject             → never executes.
 *  4. skip               → never executes.
 *  5. unknown decision   → never executes (fail-closed on an unrecognized verdict).
 *  6. mutating built-in, no explicit approval → gated (fail-closed BY CATEGORY,
 *     so a brand-new mutating tool is gated by default, not allow-listed).
 *  7. read-only / non-mutating built-in       → executes with no gate.
 *  8. an MCP tool its server does not mark destructive → executes with no
 *     gate; one it marks destructive → gated (the default reads the server's
 *     own destructiveHint, nothing else).
 *  9. cross-tool isolation: approving a write never authorizes a shell
 *     (capability: enforcesExactResource).
 * 10. exact-resource: approving write /a never authorizes write /b
 *     (capability: enforcesExactResource).
 * 11. class-lease isolation: APPROVE_ALL on class A auto-approves later class-A
 *     actions but never class B (capability: appliesRunLifetimeLease).
 *
 *
 * The agent's tool lists (`tools` / `disallowed_tools`, Claude Code's names):
 * 13. an allow-list is exact: a named tool runs, anything else is refused.
 * 14. deny is applied first, and a specifier governs the whole tool.
 * 15. a deny-list leaves the rest to the approval default.
 * 16. the lists bind under "trust this whole run" (no gate installed).
 * 17. a refusal never asks: a refused call is never gated or executed.
 * 18. with Read excluded, the platform's own content stays readable.
 * 19. a sub-agent narrows the agent's tools and never widens them
 *     (capability: enforcesSubAgentLists).
 *
 * An agent's hooks, in Claude Code's format (capability: runsHooks):
 * 20. a hook's deny refuses the call: the tool never runs and the model
 *     reads the hook's reason; exit code 2 denies with stderr as the reason.
 * 21. a hook's allow runs a call the default would ask about.
 * 22. a hook's ask shows the card, naming the hook; approving it runs the
 *     call once.
 * 23. a hook's deny binds under "trust this whole run", and its ask is
 *     satisfied there.
 * 24. a hook that fails or times out decides nothing: the default decides.
 * 25. a hook lease clears only that hook's asks on that tool; a category
 *     lease never clears a hook's ask.
 * 26. unattended, a hook's ask is a skip.
 * 27. a hook's rewritten input replaces the arguments.
 * 28. PostToolUse feedback reaches the model; a failed tool runs none.
 * 29. a secret-like write is blocked whatever a hook says.
 * 30. inside a sub-agent a hook sees the sub-agent's type.
 * 31. on resume the hook runs again, and a deny then binds even after an
 *     approval.
 * 32. a call the tool lists exclude never reaches a hook.
 *
 * Capability-gated invariants (9, 10, 11, 19) run only where the substrate supports
 * the relevant lease; the "executes exactly once" count in (2) is asserted only
 * where the substrate observes execution. Differences are gated, never forked —
 * the same philosophy as the conformance suite's CapabilityFlags.
 */

import { describe, it, expect } from "vitest";
import type {
  ContractHook,
  ContractHookBehaviour,
  GatewayDecision,
  GatewaySubstrate,
  HooksOutcome,
  ListsOutcome,
  ProposedAction,
} from "./types.js";

/** Representative actions shared by the per-substrate and cross-substrate suites. */
const WRITE_A: ProposedAction = { kind: "write", resource: "/work/alpha.txt" };
const WRITE_B: ProposedAction = { kind: "write", resource: "/work/beta.txt" };
// Same file as WRITE_A, DIFFERENT content — the sibling-isolation probe (a
// second distinct edit to an already-approved file must re-gate).
const WRITE_A_V2: ProposedAction = { kind: "write", resource: "/work/alpha.txt", content: "a different body" };
const SHELL: ProposedAction = { kind: "shell", resource: "rm -rf build" };
const DELETE: ProposedAction = { kind: "delete", resource: "/work/gamma.txt" };
const READ: ProposedAction = { kind: "read", resource: "/work/alpha.txt" };
const MCP: ProposedAction = {
  kind: "mcp",
  resource: "",
  mcpServerSlug: "srv",
  mcpToolName: "search_issues",
};
const MCP_OTHER: ProposedAction = { kind: "mcp", resource: "", mcpServerSlug: "srv", mcpToolName: "close_issue" };
const MCP_DESTRUCTIVE: ProposedAction = {
  kind: "mcp",
  resource: "",
  mcpServerSlug: "srv",
  mcpToolName: "delete_repository",
  mcpDestructive: true,
};
const PLATFORM_READ: ProposedAction = { kind: "read", resource: "skills/guide/SKILL.md", platformContent: true };
const SECRET_WRITE: ProposedAction = { kind: "write", resource: "/work/.env", content: "TOKEN=x" };

/** Assert a lists drive refused the call: not run, not asked. */
function expectRefused(substrate: GatewaySubstrate, what: string, outcome: ListsOutcome): void {
  expect(outcome.refused, `${substrate.name}: ${what} must be refused by the lists`).toBe(true);
  expect(outcome.executed, `${substrate.name}: a refused ${what} must not run`).toBe(false);
  expect(outcome.gated, `${substrate.name}: a refused ${what} must never ask for approval`).toBe(false);
}

/** A PreToolUse hook on shell commands. */
function onShell(does: ContractHookBehaviour, extra: Partial<ContractHook> = {}): ContractHook {
  return { event: "PreToolUse", matcher: "Bash", does, ...extra };
}

/** Assert a hooks drive's call never ran and asked nobody. */
function expectHookRefused(substrate: GatewaySubstrate, what: string, outcome: HooksOutcome): void {
  expect(outcome.refusedBy, `${substrate.name}: ${what} must be refused by the hook`).toBe("hook");
  expect(outcome.executed, `${substrate.name}: ${what} must not run`).toBe(false);
  expect(outcome.gated, `${substrate.name}: ${what} must not ask`).toBe(false);
}

/** Assert a lists drive let the call run with no approval asked. */
function expectRan(substrate: GatewaySubstrate, what: string, outcome: ListsOutcome): void {
  expect(outcome.refused, `${substrate.name}: ${what} must not be refused`).toBe(false);
  expect(outcome.gated, `${substrate.name}: ${what} must not ask`).toBe(false);
  expect(outcome.executed, `${substrate.name}: ${what} must run`).toBe(true);
}

/**
 * Register the P0 safety invariants against one substrate. The suite is skipped
 * (not failed) when the substrate is unavailable in this environment.
 */
export function describeGatewayContract(substrate: GatewaySubstrate): void {
  const suite = substrate.available ? describe : describe.skip;

  suite(`gateway contract — ${substrate.name}`, () => {
    // Invariants 1 + 6: a mutating built-in with no backing authorization is
    // gated and does not execute (fail-closed by category, every category).
    it("gates every mutating built-in with no backing authorization", async () => {
      for (const action of [WRITE_A, SHELL, DELETE]) {
        const outcome = await substrate.authorize(action, "none");
        expect(outcome.gated, `${substrate.name}: ${action.kind} must be gated without an authorization`).toBe(true);
        expect(outcome.executed, `${substrate.name}: ${action.kind} must NOT execute without an authorization`).toBe(false);
      }
    });

    // Invariant 2: approve → executes exactly once (count asserted where observable).
    it("executes a mutating built-in exactly once after approve", async () => {
      const outcome = await substrate.authorize(WRITE_A, "approve");
      expect(outcome.executed, `${substrate.name}: an approved write must execute`).toBe(true);
      if (substrate.capabilities.observesExecution) {
        expect(outcome.executionCount, `${substrate.name}: an approved write must execute exactly once`).toBe(1);
      }
    });

    // Invariants 3, 4, 5: no non-approving verdict may execute.
    for (const decision of ["reject", "skip", "unknown"] as const) {
      it(`never executes after a ${decision} decision`, async () => {
        const outcome = await substrate.authorize(WRITE_A, decision);
        expect(outcome.executed, `${substrate.name}: a ${decision}-ed write must never execute`).toBe(false);
      });
    }

    // Invariant 1 (provenance corollary): every side effect the gate withholds
    // carries a non-UNSPECIFIED authorization provenance — so an authorized side
    // effect is always auditable to the policy layer that governed it. Gated to
    // substrates that decide the source at the gate (the deep-agent gate); the
    // Cursor substrate projects provenance at reconstruction time and is covered
    // by the translator + boundary-rows + corpus suites.
    if (substrate.capabilities.surfacesGatePolicySource) {
      it("tags every gated side effect with a non-UNSPECIFIED policy source", async () => {
        for (const action of [WRITE_A, SHELL, DELETE]) {
          const outcome = await substrate.authorize(action, "none");
          expect(outcome.gated, `${substrate.name}: ${action.kind} must be gated`).toBe(true);
          expect(
            outcome.policySource,
            `${substrate.name}: a gated ${action.kind} must carry a policy source`,
          ).toBeTruthy();
          expect(
            outcome.policySource,
            `${substrate.name}: a gated ${action.kind}'s source must not be UNSPECIFIED`,
          ).not.toBe("unspecified");
        }
      });
    }

    // Invariant 7: a non-mutating built-in runs without a gate.
    it("executes a non-mutating built-in without a gate", async () => {
      const outcome = await substrate.authorize(READ, "none");
      expect(outcome.gated, `${substrate.name}: a read must not be gated`).toBe(false);
      expect(outcome.executed, `${substrate.name}: a read must execute`).toBe(true);
    });

    // Invariant 8: an MCP tool its server does not mark destructive runs
    // without a gate; one it marks destructive is withheld.
    it("executes an MCP tool its server does not mark destructive without a gate", async () => {
      const outcome = await substrate.authorize(MCP, "none");
      expect(outcome.gated, `${substrate.name}: an unmarked MCP tool must not be gated`).toBe(false);
      expect(outcome.executed, `${substrate.name}: an unmarked MCP tool must execute`).toBe(true);
    });

    it("gates an MCP tool its server marks destructive", async () => {
      const outcome = await substrate.authorize(MCP_DESTRUCTIVE, "none");
      expect(outcome.gated, `${substrate.name}: a destructive MCP tool must be gated`).toBe(true);
      expect(outcome.executed, `${substrate.name}: a destructive MCP tool must not execute unapproved`).toBe(false);
      if (substrate.capabilities.surfacesGatePolicySource) {
        expect(outcome.policySource, `${substrate.name}: the gate names the server's annotation`).toBe(
          "annotation_destructive_tighten",
        );
      }
    });

    // Invariant 13: an allow-list is exact.
    it("an allow-list runs what it names and refuses everything else (invariant 13)", async () => {
      const lists = { tools: ["Read", "mcp__srv__search_issues"], disallowedTools: [] };
      expectRan(substrate, "a listed read", await substrate.authorizeUnderLists(lists, READ));
      expectRan(substrate, "a listed MCP tool", await substrate.authorizeUnderLists(lists, MCP));
      expectRefused(substrate, "an unlisted shell", await substrate.authorizeUnderLists(lists, SHELL));
      expectRefused(substrate, "an unlisted write", await substrate.authorizeUnderLists(lists, WRITE_A));
      expectRefused(substrate, "an unlisted tool of a listed server", await substrate.authorizeUnderLists(lists, MCP_OTHER));
    });

    // Invariant 14: deny first; a specifier governs the whole tool.
    it("applies deny first, and a specifier governs the whole tool (invariant 14)", async () => {
      const both = { tools: ["Read", "Write"], disallowedTools: ["Write"] };
      expectRefused(substrate, "a write both listed and denied", await substrate.authorizeUnderLists(both, WRITE_A));
      expectRan(substrate, "a listed read", await substrate.authorizeUnderLists(both, READ));
      const specifier = { tools: [], disallowedTools: ["Bash(git push *)"] };
      expectRefused(substrate, "any shell under Bash(git push *)", await substrate.authorizeUnderLists(specifier, SHELL));
    });

    // Invariants 15 and 17: a deny-list leaves the rest to the default.
    it("a deny-list refuses what it names and leaves the rest to the approval default (invariants 15, 17)", async () => {
      const lists = { tools: [], disallowedTools: ["Bash", "mcp__srv__close_issue"] };
      expectRefused(substrate, "a denied shell", await substrate.authorizeUnderLists(lists, SHELL));
      expectRefused(substrate, "a denied MCP tool", await substrate.authorizeUnderLists(lists, MCP_OTHER));
      expectRan(substrate, "an undenied MCP tool", await substrate.authorizeUnderLists(lists, MCP));
      const write = await substrate.authorizeUnderLists(lists, WRITE_A);
      expect(write.refused, `${substrate.name}: an undenied write is the default's, not the lists'`).toBe(false);
      expect(write.gated, `${substrate.name}: the default still asks before an undenied write`).toBe(true);
      const destructive = await substrate.authorizeUnderLists(lists, MCP_DESTRUCTIVE);
      expect(destructive.gated, `${substrate.name}: the default still asks before a destructive MCP tool`).toBe(true);
    });

    // Invariant 16: the lists bind under "trust this whole run".
    it("binds under trust this whole run (invariant 16)", async () => {
      const lists = { tools: [], disallowedTools: ["Bash", "mcp__srv"] };
      const trust = { autoApproveAll: true };
      expectRefused(substrate, "a denied shell under trust", await substrate.authorizeUnderLists(lists, SHELL, trust));
      expectRefused(substrate, "a denied server's tool under trust", await substrate.authorizeUnderLists(lists, MCP, trust));
      expectRan(substrate, "an undenied write under trust", await substrate.authorizeUnderLists(lists, WRITE_A, trust));
    });

    // Invariant 18: Read excluded still reads the platform's own content.
    it("with Read excluded, refuses workspace reads but keeps the platform's content readable (invariant 18)", async () => {
      const lists = { tools: ["Grep"], disallowedTools: [] };
      expectRefused(substrate, "a workspace read", await substrate.authorizeUnderLists(lists, READ));
      expectRan(substrate, "a read of the platform's content", await substrate.authorizeUnderLists(lists, PLATFORM_READ));
    });

    // Invariant 19: a sub-agent narrows and never widens.
    if (substrate.capabilities.enforcesSubAgentLists) {
      it("a sub-agent narrows the agent's tools and never widens them (invariant 19)", async () => {
        const agent = { tools: ["Read", "Write"], disallowedTools: [] };
        const subAgent = { tools: ["Read", "Bash"], disallowedTools: [] };
        expectRefused(
          substrate,
          "a shell the sub-agent lists but the agent does not",
          await substrate.authorizeUnderLists(agent, SHELL, { subAgent }),
        );
        expectRefused(
          substrate,
          "a write the agent lists but the sub-agent does not",
          await substrate.authorizeUnderLists(agent, WRITE_A, { subAgent }),
        );
        expectRan(substrate, "a read both list", await substrate.authorizeUnderLists(agent, READ, { subAgent }));
      });
    }

    if (substrate.capabilities.runsHooks && substrate.authorizeUnderHooks) {
      describeHooksContract(substrate, substrate.authorizeUnderHooks.bind(substrate));
    }

    // Invariants 9, 10: lease isolation — only meaningful where the substrate
    // binds the exact resource. Gated honestly rather than asserted everywhere.
    if (substrate.capabilities.enforcesExactResource && substrate.authorizeAfterGrant) {
      const afterGrant = substrate.authorizeAfterGrant.bind(substrate);

      it("honors a grant only for the exact approved resource (invariant 10)", async () => {
        const sameResource = await afterGrant(WRITE_A, WRITE_A);
        expect(sameResource.executed, `${substrate.name}: the exact granted resource must be allowed`).toBe(true);

        const otherResource = await afterGrant(WRITE_A, WRITE_B);
        expect(otherResource.executed, `${substrate.name}: a different resource must be re-gated, not allowed`).toBe(false);
      });

      it("never lets one tool's approval authorize another tool (invariant 9)", async () => {
        const crossTool = await afterGrant(WRITE_A, SHELL);
        expect(crossTool.executed, `${substrate.name}: approving a write must never authorize a shell`).toBe(false);
      });
    }

    // Invariant 12: content-exact isolation — approving ONE edit to a file never
    // authorizes a DIFFERENT edit to the SAME file (the deny-only "sibling hole").
    // Only meaningful where the grant binds content; gated, never forked.
    if (substrate.capabilities.enforcesExactContent && substrate.authorizeAfterGrant) {
      const afterGrant = substrate.authorizeAfterGrant.bind(substrate);

      it("honors a grant only for the exact approved content (invariant 12: sibling isolation)", async () => {
        const sameContent = await afterGrant(WRITE_A, WRITE_A);
        expect(sameContent.executed, `${substrate.name}: re-issuing the exact approved edit must be allowed`).toBe(true);

        const otherContent = await afterGrant(WRITE_A, WRITE_A_V2);
        expect(otherContent.executed, `${substrate.name}: a DIFFERENT edit to the same file must re-gate`).toBe(false);
      });
    }

    // Invariant 11: a run-lifetime CLASS lease (APPROVE_ALL) auto-approves later
    // actions of the SAME class but never a different class — the core
    // scoped-lease safety property, enforced independently on each substrate (the
    // gate clears leased categories; the hook reads leasedCategories).
    if (substrate.capabilities.appliesRunLifetimeLease && substrate.authorizeUnderClassLease) {
      const underLease = substrate.authorizeUnderClassLease.bind(substrate);

      it("a class lease auto-approves that class and ONLY that class (invariant 11)", async () => {
        // Lease "write": a later write of a DIFFERENT resource runs ungated...
        const sameClass = await underLease(WRITE_A, WRITE_B);
        expect(sameClass.executed, `${substrate.name}: a write lease must auto-approve another write`).toBe(true);

        // ...but later actions of OTHER classes are still gated, never leaked.
        const shellUnderWrite = await underLease(WRITE_A, SHELL);
        expect(shellUnderWrite.executed, `${substrate.name}: a write lease must NOT authorize a shell`).toBe(false);

        const deleteUnderWrite = await underLease(WRITE_A, DELETE);
        expect(deleteUnderWrite.executed, `${substrate.name}: a write lease must NOT authorize a delete`).toBe(false);

        // Symmetry: a shell lease auto-approves shell but not write.
        const shellUnderShell = await underLease(SHELL, { kind: "shell", resource: "make build" });
        expect(shellUnderShell.executed, `${substrate.name}: a shell lease must auto-approve another shell`).toBe(true);

        const writeUnderShell = await underLease(SHELL, WRITE_A);
        expect(writeUnderShell.executed, `${substrate.name}: a shell lease must NOT authorize a write`).toBe(false);
      });
    }
  });
}

/** Invariants 20 to 32: an agent's hooks at the gate. */
function describeHooksContract(
  substrate: GatewaySubstrate,
  under: NonNullable<GatewaySubstrate["authorizeUnderHooks"]>,
): void {
  describe("hooks", () => {
    it("a hook's deny refuses the call with its reason; exit 2 denies with stderr (invariant 20)", async () => {
      const json = await under([onShell({ answer: "deny", reason: "no recursive deletes" })], SHELL);
      expectHookRefused(substrate, "a shell the hook denies", json);
      expect(json.modelRead).toContain("no recursive deletes");
      const exit2 = await under([onShell({ exit: 2, stderr: "blocked by policy" })], SHELL);
      expectHookRefused(substrate, "a shell the hook exits 2 on", exit2);
      expect(exit2.modelRead).toContain("blocked by policy");
    });

    it("a hook's allow runs a call the default would ask about (invariant 21)", async () => {
      const outcome = await under([onShell({ answer: "allow" })], SHELL);
      expect(outcome.gated, `${substrate.name}: an allowed shell must not ask`).toBe(false);
      expect(outcome.executed, `${substrate.name}: an allowed shell must run`).toBe(true);
    });

    it("a hook's ask shows the card naming the hook; approving runs the call once (invariant 22)", async () => {
      const held = await under([{ event: "PreToolUse", matcher: "Read", does: { answer: "ask", reason: "reads need a person" } }], READ);
      expect(held.gated, `${substrate.name}: a hook's ask must show a card even where the default asks nothing`).toBe(true);
      expect(held.executed).toBe(false);
      expect(held.policySource).toBe("hook");
      expect(held.policyHook).toBe("safety");
      const approved = await under([onShell({ answer: "ask" })], SHELL, { decision: "approve" });
      expect(approved.executed).toBe(true);
      if (substrate.capabilities.observesExecution) expect(approved.executionCount).toBe(1);
      const rejected = await under([onShell({ answer: "ask" })], SHELL, { decision: "reject" });
      expect(rejected.executed).toBe(false);
    });

    it("a hook's deny binds under trust this whole run, and its ask is satisfied there (invariant 23)", async () => {
      const trust = { autoApproveAll: true };
      expectHookRefused(substrate, "a denied shell under trust", await under([onShell({ answer: "deny" })], SHELL, trust));
      const asked = await under([onShell({ answer: "ask" })], SHELL, trust);
      expect(asked.gated).toBe(false);
      expect(asked.executed).toBe(true);
    });

    it("a hook that fails or times out decides nothing, and the default decides (invariant 24)", async () => {
      for (const does of [{ exit: 1, stderr: "crashed" }, { hang: true }] as const) {
        const shell = await under([onShell(does)], SHELL);
        expect(shell.gated, `${substrate.name}: the default still asks before a shell`).toBe(true);
        expect(shell.policySource).toBe("builtin_category");
        const read = await under([{ event: "PreToolUse", matcher: "Read", does }], READ);
        expect(read.executed, `${substrate.name}: the default still lets a read run`).toBe(true);
      }
    });

    it("a hook lease clears only that hook's asks on that tool; a category lease never does (invariant 25)", async () => {
      const ask = [onShell({ answer: "ask" })];
      const leased = await under(ask, SHELL, { hookLease: { plugin: "safety", action: SHELL } });
      expect(leased.gated, `${substrate.name}: the hook's own lease clears its ask`).toBe(false);
      expect(leased.executed).toBe(true);
      const otherTool = await under(ask, SHELL, { hookLease: { plugin: "safety", action: WRITE_A } });
      expect(otherTool.gated, `${substrate.name}: a lease on another tool does not clear it`).toBe(true);
      const otherHook = await under(ask, SHELL, { hookLease: { plugin: "other", action: SHELL } });
      expect(otherHook.gated, `${substrate.name}: another hook's lease does not clear it`).toBe(true);
      const category = await under(ask, SHELL, { categoryLease: "shell" });
      expect(category.gated, `${substrate.name}: a category lease never clears a hook's ask`).toBe(true);
      expect(category.policySource).toBe("hook");
    });

    it("unattended, a hook's ask is a skip (invariant 26)", async () => {
      const outcome = await under([onShell({ answer: "ask" })], SHELL, { unattended: true });
      expect(outcome.gated).toBe(false);
      expect(outcome.executed).toBe(false);
      expect(outcome.refusedBy).toBeUndefined();
    });

    it("a hook's rewritten input replaces the arguments (invariant 27)", async () => {
      const outcome = await under(
        [{ event: "PreToolUse", matcher: "Write", does: { answer: "allow", rewrite: WRITE_B } }],
        WRITE_A,
      );
      expect(outcome.executed).toBe(true);
      expect(outcome.writtenPaths).toEqual([WRITE_B.resource]);
    });

    it("PostToolUse feedback reaches the model, and a failed tool runs none (invariant 28)", async () => {
      const post: ContractHook = {
        event: "PostToolUse",
        matcher: "mcp__srv__search_issues",
        does: { postBlock: "the result names a private repo", context: "summarise without names" },
      };
      const ran = await under([post], MCP);
      expect(ran.executed).toBe(true);
      expect(ran.modelRead).toContain("the result names a private repo");
      expect(ran.modelRead).toContain("summarise without names");
      const failed = await under([post], MCP, { failTool: true });
      expect(failed.hookRuns.filter((run) => run["hook_event_name"] === "PostToolUse")).toEqual([]);
    });

    it("a secret-like write is blocked whatever a hook says (invariant 29)", async () => {
      const outcome = await under([{ event: "PreToolUse", matcher: "Write", does: { answer: "allow" } }], SECRET_WRITE);
      expect(outcome.executed).toBe(false);
      expect(outcome.writtenPaths).toEqual([]);
    });

    it("inside a sub-agent a hook sees the sub-agent's type (invariant 30)", async () => {
      const outcome = await under([onShell({ answer: "allow" })], SHELL, { subAgent: "helper" });
      expect(outcome.hookRuns[0]?.["agent_type"]).toBe("helper");
      expect(outcome.hookRuns[0]?.["agent_id"]).toBeTruthy();
    });

    it("on resume the hook runs again, and its deny binds after an approval (invariant 31)", async () => {
      const outcome = await under([onShell({ answer: "ask-then-deny" })], SHELL, { decision: "approve" });
      expect(outcome.executed).toBe(false);
      expect(outcome.refusedBy).toBe("hook");
    });

    it("a call the tool lists exclude never reaches a hook (invariant 32)", async () => {
      const outcome = await under([onShell({ answer: "deny" })], SHELL, { lists: { tools: [], disallowedTools: ["Bash"] } });
      expect(outcome.refusedBy).toBe("lists");
      expect(outcome.hookRuns).toEqual([]);
    });
  });
}

/**
 * Prove the substrates AGREE: the same logical action under the same decision
 * yields the same execution outcome on every available substrate. This is the
 * real consolidation win — one place that says "the in-process gate and the
 * out-of-process deny-oracle enforce the same policy," including the cross-taxonomy
 * collapse (a grant minted from the stream-side identity is honored by the
 * hook-side for the same action).
 *
 * Only `executed` is compared: it is the safety-critical observable and is
 * substrate-comparable, whereas `gated` carries a substrate-specific meaning on
 * an approve (the in-process gate still "paused"; the deny-oracle did not "deny").
 */
export function describeCrossSubstrateAgreement(substrates: GatewaySubstrate[]): void {
  const available = substrates.filter((s) => s.available);
  const suite = available.length >= 2 ? describe : describe.skip;

  suite("gateway contract — cross-substrate agreement", () => {
    const cases: Array<{ label: string; action: ProposedAction; decision: GatewayDecision }> = [
      { label: "a fresh write is withheld", action: WRITE_A, decision: "none" },
      { label: "an approved write executes", action: WRITE_A, decision: "approve" },
      { label: "a fresh shell is withheld", action: SHELL, decision: "none" },
      { label: "a rejected write never executes", action: WRITE_A, decision: "reject" },
      { label: "a read runs ungated", action: READ, decision: "none" },
      { label: "an unmarked MCP tool runs ungated", action: MCP, decision: "none" },
      { label: "a destructive MCP tool is withheld", action: MCP_DESTRUCTIVE, decision: "none" },
    ];

    for (const { label, action, decision } of cases) {
      it(`both substrates agree: ${label}`, async () => {
        const outcomes = await Promise.all(available.map((s) => s.authorize(action, decision)));
        const executed = outcomes.map((o) => o.executed);
        const detail = available.map((s, i) => `${s.name}=${executed[i]}`).join(", ");
        expect(new Set(executed).size, `substrates disagree on "${label}" (executed): ${detail}`).toBe(1);
      });
    }

    const listCases: Array<{ label: string; lists: { tools: string[]; disallowedTools: string[] }; action: ProposedAction; trust?: boolean }> = [
      { label: "an allow-list refuses an unlisted shell", lists: { tools: ["Read"], disallowedTools: [] }, action: SHELL },
      { label: "an allow-list runs a listed read", lists: { tools: ["Read"], disallowedTools: [] }, action: READ },
      { label: "a denied MCP server's tool is refused", lists: { tools: [], disallowedTools: ["mcp__srv"] }, action: MCP },
      { label: "a denied shell is refused under trust", lists: { tools: [], disallowedTools: ["Bash"] }, action: SHELL, trust: true },
      { label: "Read excluded keeps the platform's content", lists: { tools: ["Grep"], disallowedTools: [] }, action: PLATFORM_READ },
    ];
    for (const { label, lists, action, trust } of listCases) {
      it(`both substrates agree on the lists: ${label}`, async () => {
        const outcomes = await Promise.all(
          available.map((s) => s.authorizeUnderLists(lists, action, { autoApproveAll: trust ?? false })),
        );
        const seen = outcomes.map((o) => `${o.refused}/${o.executed}`);
        const detail = available.map((s, i) => `${s.name}=${seen[i]}`).join(", ");
        expect(new Set(seen).size, `substrates disagree on "${label}" (refused/executed): ${detail}`).toBe(1);
      });
    }
  });
}
