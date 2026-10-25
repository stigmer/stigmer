/**
 * The Claude engine's shell, served by the agent host.
 *
 * The engine keeps its own `Bash` tool, the one its model was trained on,
 * name and schema, and the SDK's `toolAliases` sends every `Bash` call to
 * this server's `bash` tool instead (`engine-options.ts`). So the command is
 * started by the host, as the native engine's is, never by the engine: it is
 * no child of the process that holds the turn's key, and it runs with the
 * environment every engine's shell gets (`shared/shell-env.ts`
 * `buildShellEnv`), the agent's own run values and nothing of the runner's.
 *
 * What a command is run with, and what it owes the turn:
 *  - the shared command runner (`shared/shell/run-command.ts`): its own
 *    process group, the output capped at both ends, the group stopped when
 *    the turn stops;
 *  - the workspace's primary directory as its working directory;
 *  - the engine's `timeout` (milliseconds, its default two minutes) clamped
 *    to the runner's ceiling (`Config.shellTimeoutMaxSeconds`), the result
 *    saying so when it was;
 *  - its output streamed to its own row as it prints (the runtime's preview
 *    pump keeps the streaming floor, `harness/preview-pump.ts`), and the
 *    stall watchdog told of every chunk, so a long build is never a stall;
 *  - the gate's decision, read again by the call's id before anything runs
 *    (`gate.ts`): a call the gate did not allow is refused here too.
 *
 * Background commands are off for this engine (`engine-env.ts`), so a call
 * always runs in the foreground. The engine shows the call under the name
 * its model used (`Bash`); the aliased name reaches only the gate.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { formatCommandOutput, runCommand } from "../../shared/shell/run-command.js";
import type { ClaudeGate } from "./gate.js";
import { inProcessServer, textResult, type InProcessCall } from "./in-process-server.js";

/** The shell's names: the server and tool the engine is pointed at, and the built-in it stands in for. */
export const HOST_SHELL_TOOL = {
  server: "stigmer",
  tool: "bash",
  aliasedName: "mcp__stigmer__bash",
  engineName: "Bash",
} as const;

/** Whether an engine tool name is the host's shell under its aliased name. */
export function isHostShell(toolName: string): boolean {
  return toolName === HOST_SHELL_TOOL.aliasedName;
}

/** The engine's own default bound on a command, which the model's `timeout` overrides. */
export const DEFAULT_SHELL_TIMEOUT_MS = 120_000;

/** What the shell runs with for one turn. */
export interface HostShellOptions {
  readonly cwd: string;
  /** The command's whole environment (`buildShellEnv`). */
  readonly env: Record<string, string>;
  readonly maxTimeoutSeconds: number;
  readonly gate: Pick<ClaudeGate, "verdictOf">;
  /** Stops every running command (the turn's stop). */
  readonly stopSignal: AbortSignal;
  /** Told each chunk of a call's output as it prints, by the call's id. */
  readonly onOutput: (toolUseId: string, chunk: string) => void;
  /** Told the shell made progress. */
  readonly onActivity: (detail: string) => void;
}

/** The tool's schema: the engine's own `Bash` arguments, which the alias hands over unchanged. */
const BASH_TOOL = {
  name: HOST_SHELL_TOOL.tool,
  description: "Run a shell command in the workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "The command to run." },
      timeout: { type: "number", description: "How long the command may run, in milliseconds." },
      description: { type: "string", description: "What the command does, in a few words." },
    },
    required: ["command"],
  },
};

/** The host's shell as an in-process server for the engine. */
export function hostShellServer(options: HostShellOptions): ReturnType<typeof inProcessServer> {
  return inProcessServer(HOST_SHELL_TOOL.server, () => [BASH_TOOL], (call) => runShellCall(options, call));
}

/** One `Bash` call, run once the gate's decision for it reads allow. */
export async function runShellCall(options: HostShellOptions, call: InProcessCall): Promise<CallToolResult> {
  const verdict = options.gate.verdictOf(call.toolUseId);
  if (verdict === undefined || !verdict.allow) {
    return textResult(verdict?.allow === false ? verdict.message : "The gate made no decision for this call; it was not run.", true);
  }
  const command = typeof call.args.command === "string" ? call.args.command : "";
  if (command.trim() === "") return textResult("No command was given.", true);
  const { timeoutSeconds, clamped } = timeoutOf(call.args.timeout, options.maxTimeoutSeconds);

  const result = await runCommand({
    command,
    cwd: options.cwd,
    env: options.env,
    timeoutSeconds,
    signal: options.stopSignal,
    onOutput: (chunk) => {
      options.onOutput(call.toolUseId, chunk);
      options.onActivity(HOST_SHELL_TOOL.engineName);
    },
  });

  let text = formatCommandOutput(result);
  if (result.timedOut) text += `\n\nThe command was stopped at its timeout of ${timeoutSeconds} seconds.`;
  if (clamped) text += `\n\nThe timeout asked for was above this runner's limit; the command was given ${timeoutSeconds} seconds.`;
  if (result.aborted) text += "\n\nThe command was stopped because the turn stopped.";
  if (result.spawnError !== undefined) text = `The command could not start: ${result.spawnError}`;
  const failed = result.spawnError !== undefined || result.timedOut || result.aborted || (result.exitCode ?? 1) !== 0;
  return textResult(text, failed);
}

/** The bound a call runs under, in whole seconds, and whether the runner's ceiling cut it. */
export function timeoutOf(requestedMs: unknown, maxSeconds: number): { timeoutSeconds: number; clamped: boolean } {
  const ms = typeof requestedMs === "number" && Number.isFinite(requestedMs) && requestedMs > 0 ? requestedMs : DEFAULT_SHELL_TIMEOUT_MS;
  const seconds = Math.ceil(ms / 1000);
  return seconds > maxSeconds ? { timeoutSeconds: maxSeconds, clamped: true } : { timeoutSeconds: seconds, clamped: false };
}
