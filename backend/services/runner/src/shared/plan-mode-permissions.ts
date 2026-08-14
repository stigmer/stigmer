/**
 * The Plan-mode filesystem permission rules — the enforcement twin of
 * `plan-mode-prompt.ts` (which carries the instruction half of the contract).
 *
 * Plan mode's policy is: reads anywhere in the workspace, writes nowhere.
 * Only the write half needs a RULE. The read boundary that issue #528 built
 * out of rules (workspace read-allow + read-deny, glob-escaped real root) is
 * now STRUCTURAL: every native-harness backend is virtual-rooted
 * (`virtualMode: true` — see cas-capture-backend.ts, issue #754), so every
 * path a tool can express resolves inside the workspace root and traversal
 * is rejected at resolution. A rule cannot widen that, and no workspace-root
 * glob is needed to narrow it — which also retires the whole
 * special-characters-in-the-root hazard (`escapeGlobLiteral` and its
 * end-to-end matcher suite) that the real-path rules carried.
 *
 * Paths in these rules are VIRTUAL: "/" is the workspace root, matched by
 * micromatch against the raw tool-call path (dot:true) after the
 * path-normalization middleware has canonicalized it (relative → "/"-rooted;
 * see middleware/path-normalization.ts). The legitimate platform-dir reads
 * (skills, attachments, the approved plan) keep working exactly as before:
 * they are addressed through the `{workspace}/.stigmer` symlink
 * (shared/workspace/stigmer-link.ts), an in-root path string in either
 * dialect.
 *
 * Applied in execute-deep-agent/setup.ts to the parent graph AND threaded
 * into every compiled sub-agent graph: deepagents' parent-permission
 * inheritance covers only spec-style sub-agents, and ours are pre-built
 * CompiledSubAgents, so each sub-agent graph must carry the rules itself
 * (issue #255). Kept as its own side-effect-free module so tests can pin the
 * production rules without dragging in setup.ts's import graph.
 *
 * Invariant: never combine these rules with a shell-capable (sandbox)
 * backend — deepagents rejects that pairing at graph construction (see the
 * cas-capture-backend.ts header). Plan mode guarantees it by construction:
 * it is the mode that clears `shellEnv`, and `shellEnv` is the single switch
 * for shell capability on both the parent and sub-agent backends.
 */

import type { FilesystemPermission } from "deepagents";

/**
 * Build the plan-mode rule set. One rule IS the policy: writes denied
 * everywhere ("/**" is every virtual path; deepagents evaluates
 * first-match-wins with a permissive default, so reads stay allowed —
 * workspace-confined structurally, not by rule).
 *
 * Deliberately parameterless: the pre-#754 signature took the workspace root
 * to build a real-path read fence; resurrecting a root-derived rule would
 * silently mismatch the virtual dialect the enforcement now sees.
 */
export function buildPlanModePermissions(): FilesystemPermission[] {
  return [{ operations: ["write"], paths: ["/**"], mode: "deny" }];
}
