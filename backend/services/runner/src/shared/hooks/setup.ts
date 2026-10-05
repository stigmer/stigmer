/**
 * A turn's hooks, turned into the evaluator (`evaluate.ts`): the half of the
 * setup no engine owns. Each engine's adapter passes the runtime's resolved
 * sources (every plugin mounted and verified) with its own views of its
 * calls (`tool-view.ts` for the native engine, `execute-cursor/
 * hook-views.ts` for Cursor), and gets the evaluator back, or `null` when
 * the agent has no hook either engine runs.
 *
 * What a hook runs WITH is the agent shell's, on both engines: the runner's
 * process environment less its credentials, plus the run values the agent
 * declares less every key an MCP server claims (`../shell-env.ts`). They are
 * built even in plan mode, where the agent has no shell, because hooks
 * still run there. A plugin's `${user_config.KEY}` resolves from those
 * values; one the run does not have refuses the turn, naming the variable
 * and the plugin, and so does a shell-form handler (every Cursor handler is
 * one) when no `bash` is on the hook's `PATH`. A hook that cannot run as
 * written is a policy that vanished, and Stigmer has no enable-time prompt
 * to ask for the value instead; what a single run does with a missing
 * script or a failing exit stays its format's rule.
 */

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { HookGroup } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";

import type { ResolvedMcpServer } from "../mcp-resolver.js";
import type { MountedPlugin } from "../plugin-mount.js";
import { buildShellEnv, shellRunValues } from "../shell-env.js";
import type { ProvisionResult } from "../workspace/types.js";
import { HookEvaluator, type HookPermissionMode } from "./evaluate.js";
import { HookSet, isRunEvent, userConfigKeys, type HookFormatName, type HookSourceGroups } from "./hook-set.js";
import { activityPulseFor, HOOK_SHELL } from "./run.js";
import type { HookToolViews } from "./tool-view.js";

/** The agent's hooks cannot run as written this turn; the message names what and why. */
export class HookSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookSetupError";
  }
}

/** What the setup reads from the turn, as each adapter hands it over. */
export interface HookSetupInput {
  /** The runtime's resolved sources, in the agent's order. */
  readonly sources: readonly {
    readonly plugin: MountedPlugin | null;
    readonly format: HookFormatName;
    readonly groups: readonly HookGroup[];
  }[];
  /** The run's values (`TurnInput.environment.envVars`). */
  readonly runValues: Readonly<Record<string, string>>;
  /** The agent's declared env (`AgentSpec.env`); none for the built-in assistant. */
  readonly agentEnv: Readonly<Record<string, unknown>> | undefined;
  readonly mcpServers: readonly ResolvedMcpServer[];
  readonly provisionResults: readonly ProvisionResult[];
  /** The engine's views of its calls. */
  readonly views: HookToolViews;
  readonly sessionId: string;
  readonly executionId: string;
  readonly model: string;
  readonly workspaceRoot: string;
  readonly permissionMode: HookPermissionMode;
  /** The hook leases this run holds (`ActiveLeases.hooks`). */
  readonly leases: ReadonlySet<string>;
  readonly signal: AbortSignal;
  readonly onActivity: (detail: string) => void;
  /** The turn's stall timeout; a running hook pulses often enough to stay inside it. */
  readonly stallTimeoutMs: number;
}

/** The turn's hook evaluator, or `null` when the agent has no hook this runner runs. Throws {@link HookSetupError}. */
export async function buildHookEvaluator(input: HookSetupInput): Promise<HookEvaluator | null> {
  if (input.sources.length === 0) return null;
  const values = shellRunValues(input.runValues, input.agentEnv, input.mcpServers, input.provisionResults);

  const sources: HookSourceGroups[] = input.sources.map(({ plugin, format, groups }) => {
    const who = plugin === null ? "A hook in the agent's own hooks block" : `A hook of the plugin '${plugin.slug}'`;
    const handlers = groups.filter((group) => isRunEvent(group.event, format)).flatMap((group) => group.handlers);
    if (format === "claude-code" && handlers.some((handler) => handler.args.length === 0 && handler.command.includes("${user_config."))) {
      throw new HookSetupError(
        `${who} reads \${user_config.*} in a command that runs in ${HOOK_SHELL}, where the value is not substituted. ` +
          "Pass it in args (exec form), then run again.",
      );
    }
    const options = new Map<string, string>();
    for (const key of format === "claude-code" ? handlers.flatMap(userConfigKeys) : []) {
      const value = values[key];
      if (value === undefined) {
        const claimant = input.mcpServers.find((server) => server.declaredEnvKeys.includes(key));
        throw new HookSetupError(
          claimant === undefined
            ? `${who} reads the variable ${key}, which this run does not give the agent. ` +
                `Declare ${key} in the agent's env and set its value, then run again.`
            : `${who} reads the variable ${key}, which this run keeps for its MCP server '${claimant.slug}' ` +
                "and gives neither the agent's shell nor its hooks. Give the hook a variable of its own, then run again.",
        );
      }
      options.set(key, value);
    }
    return {
      source: plugin === null
        ? { plugin: "", root: "", data: "", options }
        : { plugin: plugin.slug, root: plugin.root, data: plugin.data, options, beforeRun: plugin.verify },
      format,
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
    views: input.views,
    sessionId: input.sessionId,
    executionId: input.executionId,
    model: input.model,
    workspaceRoot: input.workspaceRoot,
    permissionMode: input.permissionMode,
    baseEnv,
    homeDir: homedir(),
    leases: input.leases,
    signal: input.signal,
    onActivity: input.onActivity,
    activityPulseMs: activityPulseFor(input.stallTimeoutMs),
  });
}

/** Claude Code's `permission_mode` for a turn: `plan` in plan mode, `bypassPermissions` under the pre-armed bypass. */
export function hookPermissionMode(planMode: boolean, globalBypass: boolean): HookPermissionMode {
  if (planMode) return "plan";
  if (globalBypass) return "bypassPermissions";
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
