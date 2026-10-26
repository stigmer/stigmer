// The run flag set `run` registers (Go's registerAgentExecFlags),
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
  fileId: string[];
  approveDefault?: string;
  verbose?: boolean;
  detach?: boolean;
  workspace: string[];
  branch?: string;
  commit?: string;
  vault: string[];
  /** False when `--no-my-vault` was given. */
  myVault: boolean;
  plugin: string[];
  environment?: string;
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
    .option("--attach <path>", "a file sent with the message (at most 20), or a folder whose files the conversation keeps under .stigmer/uploads/; a file inside a --workspace folder is pointed to where it is (repeatable)", collect, [])
    .option("--file-id <id>", "a File already uploaded (stigmer file upload, or the console's Library) sent with the message, counted with --attach toward its 20 (repeatable)", collect, [])
    .option("--approve-default <action>", "answer every tool call that asks, in headless mode: allow, deny, or allow-all (allow it and every waiting call of its kind for the rest of the turn); unset denies each one")
    .option("-v, --verbose", "show run IDs and phase transitions")
    .option("--detach", "start the run and return immediately without streaming")
    .option("-w, --workspace <source>", "workspace: HTTPS git URL or local path (repeatable)", collect, [])
    .option("--branch <name>", "git branch to clone (single git workspace only)")
    .option("--commit <sha>", "git commit SHA to checkout (single git workspace only)")
    .option("--vault <ref>", "a shared vault the conversation uses, by id, org/slug or slug, after your My vault, in the order given (repeatable)", collect, [])
    .option("--no-my-vault", "leave your own My vault out of the conversation: it uses only the vaults named with --vault")
    .option("--plugin <ref>", "a plugin the conversation uses, by id, org/slug or slug: its skills, agents, MCP servers and hooks join the agent's, or the assistant's with no agent (repeatable)", collect, [])
    .option("--environment <ref>", "the environment the conversation's sandbox runs in, by id, org/slug or slug: its packages and network access, in place of the agent's or the organization's default")
    .option("--model <model>", "LLM model to use (e.g. claude-sonnet-4-6); with no --harness it runs on native, so pass --harness cursor or --harness claude for that engine's model; unset, the agent's default model for the engine applies")
    .option("--auto-approve", "automatically approve all tool executions")
    .option("--mode <mode>", 'interaction mode: "agent" (default) or "plan" (read-only)')
    .option("--service-tier <tier>", 'model service tier: "standard" or "fast" (the model, from --model or the agent\'s defaults, must have a fast tier; billed at fast rates); unset keeps the agent\'s default')
    .option("--thinking <mode>", 'extended reasoning: "disabled" or "enabled" (the model, from --model or the agent\'s defaults, must be thinking-capable; billed at base rates, uses more output tokens); unset keeps the agent\'s default')
    .option("--harness <harness>", 'execution harness for the new session: "native", "cursor" or "claude"; unset, the agent\'s engine, else your account default, else native');
}

/** Map parsed commander options onto the shared {@link AgentExecFlags} shape. */
export function toAgentExecFlags(options: AgentExecOptions): AgentExecFlags {
  return {
    message: options.message ?? "",
    attach: options.attach,
    fileIds: options.fileId,
    approveDefault: options.approveDefault ?? "",
    verbose: options.verbose === true,
    detach: options.detach === true,
    workspace: options.workspace,
    branch: options.branch ?? "",
    commit: options.commit ?? "",
    vault: options.vault,
    myVault: options.myVault,
    plugin: options.plugin,
    environment: options.environment ?? "",
    model: options.model ?? "",
    autoApprove: options.autoApprove === true,
    mode: (options.mode ?? "") as RunMode,
    serviceTier: (options.serviceTier ?? "") as ServiceTierFlag,
    thinking: (options.thinking ?? "") as ThinkingFlag,
    harness: (options.harness ?? "") as HarnessFlag,
  };
}
