/**
 * The native harness's hooks for one turn: the runtime's resolved sources
 * (`TurnInput.hooks`, every plugin mounted and verified) turned into the
 * evaluator the approval gate runs (`shared/hooks/evaluate.ts`).
 *
 * What is this harness's here is what a hook runs WITH. Its environment is
 * the agent shell's (`shell-env.ts`): the runner's process environment less
 * its credentials, plus the run values the agent declares less every key an
 * MCP server claims. They are built even in plan mode, where the agent has
 * no shell, because hooks still run there. A plugin's `${user_config.KEY}`
 * resolves from those values; one the run does not have refuses the turn,
 * naming the variable and the plugin, and so does a shell-form handler when
 * no `bash` is on the hook's `PATH`. A hook that cannot run as written is a
 * policy that vanished, and Stigmer has no enable-time prompt to ask for the
 * value instead; what a single run does with a missing script or a failing
 * exit stays Claude Code's rule (no decision, the call falls to the
 * default).
 */

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { TurnInput, TurnSink } from "../../harness/types.js";
import { normalizeWorkspacePathArg } from "../../middleware/path-normalization.js";
import { HookEvaluator, type HookPermissionMode } from "../../shared/hooks/evaluate.js";
import { HookSet, userConfigKeys, type HookSourceGroups } from "../../shared/hooks/hook-set.js";
import { activityPulseFor, HOOK_SHELL } from "../../shared/hooks/run.js";
import { NativeToolViews } from "../../shared/hooks/tool-view.js";
import { buildShellEnv, shellRunValues } from "./shell-env.js";
import type { DeepAgentTools } from "./turn-setup.js";

/** The agent's hooks cannot run as written this turn; the message names what and why. */
export class HookSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookSetupError";
  }
}

/** The turn's hook evaluator, or `null` when the agent has no hook this engine runs. Throws {@link HookSetupError}. */
export async function buildHookEvaluator(
  input: TurnInput,
  sink: Pick<TurnSink, "stopSignal" | "recordActivity">,
  tools: Pick<DeepAgentTools, "toolServerMap">,
  stallTimeoutMs: number,
): Promise<HookEvaluator | null> {
  if (input.hooks.sources.length === 0) return null;
  const primaryDir = input.workspace.primaryDir;
  const values = shellRunValues(
    input.environment.envVars,
    input.blueprint.agent?.spec?.env,
    input.mcp.servers,
    input.workspace.provision.provisionResults,
  );

  const sources: HookSourceGroups[] = input.hooks.sources.map(({ plugin, groups }) => {
    const options = new Map<string, string>();
    for (const key of groups.flatMap((group) => group.handlers.flatMap(userConfigKeys))) {
      const value = values[key];
      if (value === undefined) {
        throw new HookSetupError(
          `${plugin === null ? "A hook in the agent's own hooks block" : `A hook of the plugin '${plugin.slug}'`} ` +
            `reads the variable ${key}, which this run does not give the agent. ` +
            `Declare ${key} in the agent's env and set its value, then run again.`,
        );
      }
      options.set(key, value);
    }
    return {
      source: plugin === null
        ? { plugin: "", root: "", data: "", options }
        : { plugin: plugin.slug, root: plugin.root, data: plugin.data, options, beforeRun: plugin.verify },
      groups,
    };
  });
  const set = HookSet.of(sources);
  if (set.isEmpty) return null;

  const baseEnv = buildShellEnv(values);
  if (set.needsShell && !(await onPath(HOOK_SHELL, baseEnv["PATH"] ?? ""))) {
    throw new HookSetupError(
      `The agent's hooks include a command that runs in ${HOOK_SHELL}, and no ${HOOK_SHELL} is on this runner's PATH. ` +
        `Install ${HOOK_SHELL}, or write the hook in exec form (with args).`,
    );
  }

  return new HookEvaluator({
    set,
    views: new NativeToolViews({
      workspaceRoot: primaryDir,
      toVirtualPath: (path) => normalizeWorkspacePathArg(path, primaryDir),
      toolServerMap: tools.toolServerMap,
      pluginServers: input.hooks.pluginServers,
      platformServerSlugs: input.mcp.platformServerSlugs,
    }),
    sessionId: input.sessionId,
    workspaceRoot: primaryDir,
    permissionMode: permissionModeOf(input),
    baseEnv,
    homeDir: homedir(),
    leases: input.mcp.leases.hooks,
    signal: sink.stopSignal,
    onActivity: (detail) => sink.recordActivity(detail),
    activityPulseMs: activityPulseFor(stallTimeoutMs),
  });
}

/** Claude Code's `permission_mode` for this turn. */
export function permissionModeOf(input: TurnInput): HookPermissionMode {
  if (input.execution.spec?.executionConfig?.interactionMode === InteractionMode.PLAN) return "plan";
  if (input.mcp.leases.global) return "bypassPermissions";
  return "default";
}

/** Whether an executable named `name` is on `path`. */
async function onPath(name: string, path: string): Promise<boolean> {
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    try {
      await access(join(dir, name), constants.X_OK);
      return true;
    } catch {
      // Not here.
    }
  }
  return false;
}
