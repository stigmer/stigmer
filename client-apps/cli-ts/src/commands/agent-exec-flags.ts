// The agent-execution flag set shared by `run` and `draft` (Go's
// registerAgentExecFlags). Centralized so both commands stay in lockstep — a new
// execution flag is added here once and both surfaces pick it up.

import type { Command } from "commander";
import type { AgentExecFlags, RunMode } from "../resources/run/prepare.js";

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
}

/**
 * Register the shared agent-exec options on `command`. `requireMessage` marks
 * `-m/--message` as required (draft requires a prompt; run does not).
 */
export function addAgentExecFlags(command: Command, requireMessage = false): Command {
  const messageDesc = "initial message/prompt for execution";
  if (requireMessage) command.requiredOption("-m, --message <text>", messageDesc);
  else command.option("-m, --message <text>", messageDesc);

  return command
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
    .option("--mode <mode>", 'interaction mode: "agent" (default) or "plan" (read-only)');
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
  };
}
