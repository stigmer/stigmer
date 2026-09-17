// The agent-execution flag set `run` registers (Go's registerAgentExecFlags),
// kept as its own module so a new execution flag has one home and any future
// command that starts an execution picks the whole set up unchanged.

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
    .option("-m, --message <text>", "initial message/prompt for execution")
    .option("--attach <path>", "file or directory to attach as input (repeatable)", collect, [])
    .option("--approve-default <action>", "auto-resolve approvals in headless mode (approve, skip, reject, approve-all)")
    .option("-v, --verbose", "show execution IDs and phase transitions")
    .option("--detach", "start execution and return immediately without streaming")
    .option("-w, --workspace <source>", "workspace: HTTPS git URL or local path (repeatable)", collect, [])
    .option("--branch <name>", "git branch to clone (single git workspace only)")
    .option("--commit <sha>", "git commit SHA to checkout (single git workspace only)")
    .option("--env <kv>", "runtime env var KEY=VALUE (repeatable)", collect, [])
    .option("--env-file <path>", "load env from file (repeatable, later override earlier)", collect, [])
    .option("--secret <kv>", "secret env var KEY=VALUE (repeatable, encrypted)", collect, [])
    .option("--secret-file <path>", "load secrets from file (repeatable, encrypted)", collect, [])
    .option("--model <model>", "LLM model to use (e.g. claude-sonnet-4-6)")
    .option("--auto-approve", "automatically approve all tool executions")
    .option("--mode <mode>", 'interaction mode: "agent" (default) or "plan" (read-only)')
    .option("--service-tier <tier>", 'model service tier: "standard" (default) or "fast" (requires --model naming a model with a fast tier; billed at fast rates)')
    .option("--thinking <mode>", 'extended reasoning: "disabled" (default) or "enabled" (requires --model naming a thinking-capable model; billed at base rates, uses more output tokens)')
    .option("--harness <harness>", 'execution harness for the new session: "native" (default) or "cursor"');
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
