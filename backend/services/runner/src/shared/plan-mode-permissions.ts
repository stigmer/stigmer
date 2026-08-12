/**
 * The Plan-mode filesystem permission rules — the enforcement twin of
 * `plan-mode-prompt.ts` (which carries the instruction half of the contract).
 *
 * Plan mode is read-only BY CONSTRUCTION on the native harness: these rules
 * deny every filesystem write operation at the tool level so
 * write_file/edit_file cannot mutate the workspace regardless of what the
 * model was told. Rules are first-match-wins with a permissive default, so a
 * single deny-all-writes rule is sufficient. (The Cursor harness has no
 * tool-level lever and enforces plan mode via its prompt prefix instead.)
 *
 * Applied in execute-deep-agent/setup.ts to the parent graph AND threaded
 * into every compiled sub-agent graph: deepagents' parent-permission
 * inheritance covers only spec-style sub-agents, and ours are pre-built
 * CompiledSubAgents, so each sub-agent graph must carry the rules itself
 * (issue #255). Kept as its own side-effect-free module so tests can pin the
 * production rules without dragging in setup.ts's import graph.
 *
 * Rules travel with a companion: every graph that carries them also installs
 * the path-normalization middleware (middleware/path-normalization.ts,
 * issue #429), because deepagents' rule validation refuses workspace-relative
 * paths outright — without the shim, prompt-compliant relative READS die in
 * validation instead of just working. Both are derived from the same
 * expression at each composition site so they cannot drift apart.
 *
 * Invariant: never combine these rules with a shell-capable (sandbox)
 * backend — deepagents rejects that pairing at graph construction (see the
 * cas-capture-backend.ts header). Plan mode guarantees it by construction:
 * it is the mode that clears `shellEnv`, and `shellEnv` is the single switch
 * for shell capability on both the parent and sub-agent backends.
 */

import type { FilesystemPermission } from "deepagents";

export const PLAN_MODE_PERMISSIONS: FilesystemPermission[] = [
  { operations: ["write"], paths: ["/**"], mode: "deny" },
];
