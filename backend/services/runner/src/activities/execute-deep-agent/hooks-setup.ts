/**
 * The Stigmer harness's hooks for one turn: the runtime's resolved sources
 * (`TurnInput.hooks`, every plugin mounted and verified) turned into the
 * evaluator the approval gate runs, through the setup both engines share
 * (`shared/hooks/setup.ts`, which says what a hook runs with and when the
 * turn is refused). A saved subagent's graph runs its own evaluator: the
 * conversation's sources, then the subagent's own, each of those in the
 * subagent's environment.
 *
 * What is this harness's here is how its calls look to a hook: the Stigmer
 * views (`shared/hooks/tool-view.ts` `StigmerToolViews`), over the tools it
 * bound and the workspace's virtual paths.
 */

import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { TurnInput, TurnSink, TurnSubagent } from "../../harness/types.js";
import { hookServerNamesOf } from "../../shared/hooks/tool-view.js";
import { normalizeWorkspacePathArg } from "../../middleware/path-normalization.js";
import type { HookEvaluator, HookPermissionMode } from "../../shared/hooks/evaluate.js";
import { buildHookEvaluator as buildEvaluator, hookPermissionMode } from "../../shared/hooks/setup.js";
import { StigmerToolViews } from "../../shared/hooks/tool-view.js";
import type { DeepAgentTools } from "./turn-setup.js";

export { HookSetupError } from "../../shared/hooks/setup.js";

/**
 * The turn's hook evaluator, or `null` when the agent has no hook this
 * engine runs; with `subagent`, the evaluator that subagent's graph runs.
 * Throws `HookSetupError`.
 */
export async function buildHookEvaluator(
  input: TurnInput,
  sink: Pick<TurnSink, "stopSignal" | "recordActivity">,
  tools: Pick<DeepAgentTools, "toolServerMap">,
  stallTimeoutMs: number,
  subagent?: TurnSubagent,
): Promise<HookEvaluator | null> {
  const primaryDir = input.workspace.primaryDir;
  const serverNames = new Map([...input.hooks.serverNames, ...hookServerNamesOf(subagent?.servers ?? [])]);
  return buildEvaluator({
    sources: subagent === undefined
      ? input.hooks.sources
      : [
          ...input.hooks.sources,
          ...subagent.hooks.map((source) => ({ ...source, shellValues: subagent.values, subagent: subagent.name })),
        ],
    runValues: input.values,
    mcpServers: subagent === undefined ? input.mcp.servers : [...input.mcp.servers, ...subagent.servers],
    views: new StigmerToolViews({
      workspaceRoot: primaryDir,
      toVirtualPath: (path) => normalizeWorkspacePathArg(path, primaryDir),
      toolServerMap: tools.toolServerMap,
      serverNames,
      platformServerSlugs: input.mcp.platformServerSlugs,
    }),
    sessionId: input.sessionId,
    executionId: input.executionId,
    model: input.model.requested,
    workspaceRoot: primaryDir,
    permissionMode: permissionModeOf(input),
    leases: input.mcp.leases.hooks,
    signal: sink.stopSignal,
    onActivity: (detail) => sink.recordActivity(detail),
    stallTimeoutMs,
  });
}

/** Claude Code's `permission_mode` for this turn. */
export function permissionModeOf(input: TurnInput): HookPermissionMode {
  return hookPermissionMode(
    input.execution.spec?.interactionMode === InteractionMode.PLAN,
    input.mcp.leases.global,
  );
}
