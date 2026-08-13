/**
 * The Plan-mode filesystem permission rules — the enforcement twin of
 * `plan-mode-prompt.ts` (which carries the instruction half of the contract).
 *
 * Plan mode is contained BY CONSTRUCTION on the native harness: these rules
 * deny every filesystem write everywhere AND scope reads to the session
 * workspace (issue #528 — owner ruling: the workspace is plan mode's read
 * boundary on cloud and desktop runners alike). Without the read boundary,
 * model-provided absolute paths reached anywhere the process account could
 * read — the pod filesystem (including /proc/self/environ) on cloud runners,
 * the user's whole home directory on desktop — while plan mode still carries
 * exfiltration-capable tools (web_fetch, MCP). Rules are first-match-wins
 * with a permissive default (deepagents' decidePathAccess), so order is
 * load-bearing: the workspace read-allow must precede the read-deny.
 *
 * The workspace-root pattern is matched as a STRING against the raw tool-call
 * path (micromatch, dot:true), before the backend touches disk. That is
 * exactly why the legitimate out-of-workspace reads keep working: skills,
 * attachments, and the approved plan live in the platform dir but are
 * addressed through the `{workspace}/.stigmer` symlink (see
 * shared/workspace/stigmer-link.ts), so their path strings are in-root even
 * though the bytes are not. The same holds for multi-workspace local entries
 * (`{workspace}/{name}` symlinks). A realpath-based boundary would break
 * both; do not "harden" this into one.
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
 * issues #429/#528), because deepagents' rule validation refuses
 * workspace-relative paths outright and its `ls`/`glob`/`grep` schema default
 * of "/" would deny the bare first listing. Both are derived from the same
 * expression at each composition site so they cannot drift apart.
 *
 * Invariant: never combine these rules with a shell-capable (sandbox)
 * backend — deepagents rejects that pairing at graph construction (see the
 * cas-capture-backend.ts header). Plan mode guarantees it by construction:
 * it is the mode that clears `shellEnv`, and `shellEnv` is the single switch
 * for shell capability on both the parent and sub-agent backends.
 */

import { resolve } from "node:path";
import type { FilesystemPermission } from "deepagents";

/**
 * Backslash-escape every character micromatch/picomatch treats as glob
 * syntax, so the result matches the input literally. micromatch exports no
 * escape API of its own, and this is correctness, not caution: an unescaped
 * `(` in a desktop project path would make the workspace read-allow rule
 * silently never match — bricking every plan-mode read for that workspace.
 * Semantics are pinned end-to-end through deepagents' own matcher by the
 * special-character workspace suite in plan-mode-path-normalization.test.ts.
 */
export function escapeGlobLiteral(literal: string): string {
  return literal.replace(/[\\*?()[\]{}!+@]/g, "\\$&");
}

/**
 * Build the plan-mode rule set for a graph whose filesystem backend is
 * rooted at `workspaceRootDir`. The three rules read as the policy:
 * reads allowed in the workspace, reads denied everywhere else, writes
 * denied everywhere.
 *
 * `{root}/**` matches the root itself as well as its subtree (verified
 * against the installed micromatch), so one allow pattern suffices. The
 * root is `path.resolve`d first because enforcement canonicalizes incoming
 * paths (collapsed slashes, no trailing separator) before matching — a
 * trailing slash in the pattern would silently match nothing.
 */
export function buildPlanModePermissions(
  workspaceRootDir: string,
): FilesystemPermission[] {
  const canonicalRoot = resolve(workspaceRootDir);
  return [
    { operations: ["read"], paths: [`${escapeGlobLiteral(canonicalRoot)}/**`] },
    { operations: ["read"], paths: ["/**"], mode: "deny" },
    { operations: ["write"], paths: ["/**"], mode: "deny" },
  ];
}
