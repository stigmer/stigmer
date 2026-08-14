/**
 * Canonical virtual-path normalization for the native harness's built-in
 * filesystem tools (issues #429, #528, #754).
 *
 * The native harness speaks ONE path dialect end to end: the VIRTUAL ROOT,
 * where "/" denotes the workspace root (backends are constructed with
 * `virtualMode: true` — see execute-deep-agent/cas-capture-backend.ts). This
 * middleware is the dialect-repair seam at the model boundary. It rewrites,
 * on the deepagents built-in filesystem tools only:
 *
 *  - workspace-relative paths ("src/x.py", "./notes.md") to their virtual
 *    absolute form ("/src/x.py") — deepagents' permission validation refuses
 *    non-absolute shapes on rule-bearing graphs (plan mode), and the prompt
 *    explicitly mandates entry-relative paths, so without this seam a
 *    prompt-compliant call would die with `path must be absolute`;
 *  - REAL-absolute paths under the workspace root ("{root}/src/x.py") to
 *    their virtual form ("/src/x.py") — the compatibility mapping for the
 *    pre-#754 dialect, where tool results and transcripts surfaced real
 *    filesystem paths that a model may still echo back;
 *  - interior `..` segments that stay inside the root ("src/../notes.md" →
 *    "/notes.md") — the virtual resolver rejects `..` outright, so a safe
 *    interior collapse is repaired here rather than burning a tool round.
 *
 * Nothing becomes newly reachable: escaping relatives ("../x") and
 * `~`-carrying paths are left raw so the upstream refusal keeps speaking,
 * and every rewritten path is workspace-confined by the virtual resolver
 * regardless. The middleware converts false errors into correct behavior —
 * never a refusal into an allowance.
 *
 * Installed on EVERY native graph (parent and sub-agent, act and plan mode)
 * so all downstream consumers — the approval gate's capturability checks,
 * the CAS observer, otel spans — observe one canonical dialect. The pre-#754
 * version was installed only beside permission rules and also injected the
 * workspace root when `ls`/`glob`/`grep` omitted their path (the tools'
 * schema default "/" was the OS ROOT under the legacy backend); under the
 * virtual root that default already MEANS the workspace root, so the
 * injection is retired.
 *
 * Tool matching is by bare built-in name, the house doctrine (an MCP server
 * is not expected to shadow a built-in name — see shared/tool-kind.ts); the
 * rewrite touches only the tool's path-bearing argument, never glob/grep
 * patterns. Install FIRST in the stack so every downstream middleware
 * observes canonical paths.
 */

import { isAbsolute, relative, posix } from "node:path";
import type { StigmerMiddleware } from "./types.js";

/**
 * The path-bearing argument of each deepagents built-in filesystem tool.
 * `ls`/`glob`/`grep` take a base directory `path`; the file tools take
 * `file_path`. Confirmed against the installed deepagents' tool definitions.
 */
const PATH_ARG_BY_TOOL: ReadonlyMap<string, string> = new Map([
  ["ls", "path"],
  ["glob", "path"],
  ["grep", "path"],
  ["read_file", "file_path"],
  ["write_file", "file_path"],
  ["edit_file", "file_path"],
]);

export interface PathNormalizationConfig {
  /**
   * The REAL workspace root the graph's backend is rooted at — used only for
   * the legacy-dialect compatibility mapping (real-absolute in-root paths →
   * virtual). The virtual rewrite itself needs no root.
   */
  readonly rootDir: string;
}

/**
 * Rewrite `raw` to its canonical virtual-absolute form, or return undefined
 * when the value must be left untouched. Exported for direct unit testing of
 * the mapping table.
 *
 * Left raw (undefined): empty strings, `~`-carrying paths (refused upstream
 * in every mode), escaping relatives ("../x" — the refusal is the honest
 * answer), real-absolute paths OUTSIDE the root (virtual dialect: they name
 * an in-workspace path that simply does not exist — resolution answers
 * honestly), and paths already in canonical virtual form.
 */
export function normalizeWorkspacePathArg(
  raw: string,
  rootDir: string,
): string | undefined {
  if (raw.length === 0) return undefined;
  // Upstream validation refuses `~` segments in every position, and a rewrite
  // could not make such a call succeed — leave the honest refusal intact.
  if (raw.split("/").includes("~")) return undefined;

  // Legacy-dialect compatibility: a REAL absolute path under the workspace
  // root maps to its virtual form. Any other absolute path is already a
  // virtual-dialect name — reduced to relative form for canonicalization.
  let candidate: string;
  if (isAbsolute(raw)) {
    const rel = relative(rootDir, raw);
    if (rel === "") return "/";
    candidate =
      rel && !rel.startsWith("..") && !isAbsolute(rel)
        ? rel
        : raw.replace(/^\/+/, "");
  } else {
    candidate = raw;
  }

  // Canonicalize in RELATIVE form first: posix.normalize keeps a leading
  // ".." on relative paths but silently swallows it on absolute ones, and a
  // swallowed escape would rewrite the call onto a DIFFERENT in-root path —
  // a refusal converted into an allowance. Detect the escape while it is
  // still visible, and leave it raw for the upstream refusal.
  const normalizedRel = posix.normalize(candidate);
  if (normalizedRel === ".." || normalizedRel.startsWith("../")) return undefined;

  const virtual = normalizedRel === "." ? "/" : `/${normalizedRel}`;
  return virtual === raw ? undefined : virtual;
}

/**
 * Create the dialect-repair middleware (see module header). Stateless per
 * request; safe on every graph.
 */
export function createPathNormalizationMiddleware(
  config: PathNormalizationConfig,
): StigmerMiddleware {
  const { rootDir } = config;

  return {
    name: "PathNormalizationMiddleware",

    wrapToolCall(request, handler) {
      const argKey = PATH_ARG_BY_TOOL.get(request.toolCall.name);
      if (!argKey) return handler(request);

      const raw = request.toolCall.args[argKey];
      if (typeof raw !== "string") return handler(request);

      const normalized = normalizeWorkspacePathArg(raw, rootDir);
      if (normalized === undefined) return handler(request);

      return handler({
        ...request,
        toolCall: {
          ...request.toolCall,
          args: { ...request.toolCall.args, [argKey]: normalized },
        },
      });
    },
  };
}
