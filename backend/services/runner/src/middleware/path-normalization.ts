/**
 * Workspace-relative path normalization for permission-rule-bearing graphs
 * (issue #429).
 *
 * deepagents' permission enforcement canonicalizes tool-call paths BEFORE any
 * rule or backend runs, and its validation refuses non-absolute paths — on
 * EVERY filesystem tool call once a graph carries any permission rules, reads
 * included. Plan mode is the only rule-bearing production configuration
 * (shared/plan-mode-permissions.ts), so there a workspace-relative path —
 * the shape the multi-workspace prompt explicitly mandates, and one models
 * routinely choose in single-workspace sessions — fails with
 * `path must be absolute` instead of just working, burning tool rounds until
 * the model adapts by switching to absolute paths.
 *
 * This middleware repairs the contract at our own seam: it rewrites
 * workspace-relative paths on the deepagents built-in filesystem tools to
 * workspace-absolute before the tool (and therefore enforcement) runs. The
 * write-deny rule then fires as designed and reads succeed on the first try.
 * Rule-less (act-mode) graphs never install it — the legacy backend already
 * resolves relative paths under the workspace root, so act mode keeps a
 * byte-zero delta.
 *
 * Invariant — nothing becomes newly reachable: only paths whose resolution
 * stays INSIDE the workspace root are rewritten. Escaping relatives (`../x`)
 * and `~`-carrying paths are left raw so today's validation refusal keeps
 * speaking (a naive join would resolve `..` away and smuggle an out-of-root
 * read past validation), and absolute paths pass through byte-untouched.
 * The middleware converts false errors into correct behavior — never a
 * refusal into an allowance the rules didn't decide.
 *
 * Tool matching is by bare built-in name, the house doctrine (an MCP server
 * is not expected to shadow a built-in name — see shared/tool-kind.ts); the
 * rewrite touches only the tool's path-bearing argument, never glob/grep
 * patterns. Install FIRST in the stack so every downstream middleware
 * (approval gate, error hints, otel spans) observes canonical paths.
 */

import { isAbsolute, relative } from "node:path";
import { resolveWorkspacePath } from "../shared/file-change.js";
import type { StigmerMiddleware } from "./types.js";

/**
 * The path-bearing argument of each deepagents built-in filesystem tool.
 * `ls`/`glob`/`grep` take a base directory `path` (defaulting to "/" when
 * omitted — absolute, so untouched here); the file tools take `file_path`.
 * Confirmed against the installed deepagents' tool definitions.
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
  /** The workspace root the graph's filesystem backend resolves against. */
  readonly rootDir: string;
}

/**
 * Rewrite `raw` to its workspace-absolute form, or return undefined when the
 * value must be left untouched (absolute already, `~`-carrying, or escaping
 * the workspace root). Exported for direct unit testing of the mapping table.
 */
export function normalizeWorkspacePathArg(
  raw: string,
  rootDir: string,
): string | undefined {
  if (raw.length === 0 || isAbsolute(raw)) return undefined;
  // Upstream validation refuses `~` segments even in absolute paths, so a
  // rewrite could not make such a call succeed — leave the raw shape (and
  // therefore the honest refusal) intact.
  if (raw.split("/").includes("~")) return undefined;

  const { absolutePath } = resolveWorkspacePath(raw, rootDir, false);

  // No-new-reachability guard: `join` inside the resolver normalizes `..`
  // segments away, so an escaping relative would otherwise pass upstream
  // validation as a clean out-of-root absolute path. Today that shape is
  // refused; keep it that way.
  const rel = relative(rootDir, absolutePath);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;

  return absolutePath;
}

/**
 * Create middleware that normalizes workspace-relative paths on the built-in
 * filesystem tools before permission enforcement sees them.
 *
 * Installed only on graphs that carry filesystem permission rules — derive
 * the install condition from the same expression that supplies the rules
 * (setup.ts / compileSubagents) so the rules and their normalization shim
 * cannot drift apart.
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
