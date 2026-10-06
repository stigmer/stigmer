// The agent-run flag set `run` registers (Go's registerAgentExecFlags),
// kept as its own module so a new run flag has one home and any future
// command that starts a run picks the whole set up unchanged.

import type { Command } from "commander";
import type { AgentExecFlags, HarnessFlag, RunMode, ServiceTierFlag, ThinkingFlag } from "../resources/run/prepare.js";

/** Commander collector for repeatable string options. */
export const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** The parsed shape of the shared agent-exec options on a commander command. */
export interface AgentExecOptions {
  message?: string;
  attach: string[];
  approveDefault?: string;
  verbose?: boolean;
  detach?: boolean;
  workspace: string[];
  branch?: string;
  commit?: string;
  env: string[];
  envFile: string[];
  secret: string[];
  secretFile: string[];
  model?: string;
  autoApprove?: boolean;
  mode?: string;
  serviceTier?: string;
  thinking?: string;
  harness?: string;
}

/** Register the agent-exec options on `command`. */
export function addAgentExecFlags(command: Command): Command {
  return command
    .option("-m, --message <text>", "initial message/prompt for the run")
    .option("--attach <path>", "file or directory to attach as input (repeatable)", collect, [])
    .option("--approve-default <action>", "auto-resolve approvals in headless mode (approve, skip, reject, approve-all)")
    .option("-v, --verbose", "show run IDs and phase transitions")
    .option("--detach", "start the run and return immediately without streaming")
    .option("-w, --workspace <source>", "workspace: HTTPS git URL or local path (repeatable)", collect, [])
    .option("--branch <name>", "git branch to clone (single git workspace only)")
    .option("--commit <sha>", "git commit SHA to checkout (single git workspace only)")
    .option("--env <kv>", "runtime env var KEY=VALUE (repeatable)", collect, [])
    .option("--env-file <path>", "load env from file (repeatable, later override earlier)", collect, [])
    .option("--secret <kv>", "secret env var KEY=VALUE (repeatable, encrypted)", collect, [])
    .option("--secret-file <path>", "load secrets from file (repeatable, encrypted)", collect, [])
    .option("--model <model>", "LLM model to use (e.g. claude-sonnet-4-6); with no --harness it runs on native, so pass --harness cursor for a Cursor model; unset, the agent's default model for the engine applies")
    .option("--auto-approve", "automatically approve all tool executions")
    .option("--mode <mode>", 'interaction mode: "agent" (default) or "plan" (read-only)')
    .option("--service-tier <tier>", 'model service tier: "standard" or "fast" (the model, from --model or the agent\'s defaults, must have a fast tier; billed at fast rates); unset keeps the agent\'s default')
    .option("--thinking <mode>", 'extended reasoning: "disabled" or "enabled" (the model, from --model or the agent\'s defaults, must be thinking-capable; billed at base rates, uses more output tokens); unset keeps the agent\'s default')
    .option("--harness <harness>", 'execution harness for the new session: "native" or "cursor"; unset, the agent\'s engine, else your account default, else native');
}

/** Map parsed commander options onto the shared {@link AgentExecFlags} shape. */
export function toAgentExecFlags(options: AgentExecOptions): AgentExecFlags {
  return {
    message: options.message ?? "",
    attach: options.attach,
    approveDefault: options.approveDefault ?? "",
    verbose: options.verbose === true,
    detach: options.detach === true,
    workspace: options.workspace,
    branch: options.branch ?? "",
    commit: options.commit ?? "",
    env: options.env,
    envFile: options.envFile,
    secret: options.secret,
    secretFile: options.secretFile,
    model: options.model ?? "",
    autoApprove: options.autoApprove === true,
    mode: (options.mode ?? "") as RunMode,
    serviceTier: (options.serviceTier ?? "") as ServiceTierFlag,
    thinking: (options.thinking ?? "") as ThinkingFlag,
    harness: (options.harness ?? "") as HarnessFlag,
  };
}
