/**
 * The native harness's hooks for one turn: the runtime's resolved sources
 * (`TurnInput.hooks`, every plugin mounted and verified) turned into the
 * evaluator the approval gate runs, through the setup both engines share
 * (`shared/hooks/setup.ts`, which says what a hook runs with and when the
 * turn is refused).
 *
 * What is this harness's here is how its calls look to a hook: the native
 * views (`shared/hooks/tool-view.ts` `NativeToolViews`), over the tools it
 * bound and the workspace's virtual paths.
 */

import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import type { TurnInput, TurnSink } from "../../harness/types.js";
import { normalizeWorkspacePathArg } from "../../middleware/path-normalization.js";
import type { HookEvaluator, HookPermissionMode } from "../../shared/hooks/evaluate.js";
import { buildHookEvaluator as buildEvaluator, hookPermissionMode } from "../../shared/hooks/setup.js";
import { NativeToolViews } from "../../shared/hooks/tool-view.js";
import type { DeepAgentTools } from "./turn-setup.js";

export { HookSetupError } from "../../shared/hooks/setup.js";

/** The turn's hook evaluator, or `null` when the agent has no hook this engine runs. Throws `HookSetupError`. */
export async function buildHookEvaluator(
  input: TurnInput,
  sink: Pick<TurnSink, "stopSignal" | "recordActivity">,
  tools: Pick<DeepAgentTools, "toolServerMap">,
  stallTimeoutMs: number,
): Promise<HookEvaluator | null> {
  const primaryDir = input.workspace.primaryDir;
  return buildEvaluator({
    sources: input.hooks.sources,
    runValues: input.environment,
    mcpServers: input.mcp.servers,
    views: new NativeToolViews({
      workspaceRoot: primaryDir,
      toVirtualPath: (path) => normalizeWorkspacePathArg(path, primaryDir),
      toolServerMap: tools.toolServerMap,
      pluginServers: input.hooks.pluginServers,
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
