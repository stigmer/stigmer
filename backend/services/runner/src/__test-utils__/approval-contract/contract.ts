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
 *  8. auto-approved MCP tool                   → executes with no gate.
 *  9. cross-tool isolation: approving a write never authorizes a shell
 *     (capability: enforcesExactResource).
 * 10. exact-resource: approving write /a never authorizes write /b
 *     (capability: enforcesExactResource).
 * 11. class-lease isolation: APPROVE_ALL on class A auto-approves later class-A
 *     actions but never class B (capability: appliesRunLifetimeLease).
 *
 * Capability-gated invariants (9, 10, 11) run only where the substrate supports
 * the relevant lease; the "executes exactly once" count in (2) is asserted only
 * where the substrate observes execution. Differences are gated, never forked —
 * the same philosophy as the conformance suite's CapabilityFlags.
 */

import { describe, it, expect } from "vitest";
import type { GatewayDecision, GatewaySubstrate, ProposedAction } from "./types.js";

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
  mcpServerSlug: "github",
  mcpToolName: "search_issues",
};

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
    // by the message-translator + corpus suites.
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

    // Invariant 8: an auto-approved MCP tool runs without a gate.
    it("executes an auto-approved MCP tool without a gate", async () => {
      const outcome = await substrate.authorize(MCP, "none");
      expect(outcome.gated, `${substrate.name}: an auto-approved MCP tool must not be gated`).toBe(false);
      expect(outcome.executed, `${substrate.name}: an auto-approved MCP tool must execute`).toBe(true);
    });

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
    // actions of the SAME class but never a different class — the core Phase-7
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
      { label: "an auto-approved MCP tool runs ungated", action: MCP, decision: "none" },
    ];

    for (const { label, action, decision } of cases) {
      it(`both substrates agree: ${label}`, async () => {
        const outcomes = await Promise.all(available.map((s) => s.authorize(action, decision)));
        const executed = outcomes.map((o) => o.executed);
        const detail = available.map((s, i) => `${s.name}=${executed[i]}`).join(", ");
        expect(new Set(executed).size, `substrates disagree on "${label}" (executed): ${detail}`).toBe(1);
      });
    }
  });
}
