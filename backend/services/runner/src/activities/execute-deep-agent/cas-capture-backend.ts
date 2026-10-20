/**
 * CAS-capturing deepagents backends for the native harness.
 *
 * WHY A BACKEND WRAPPER, NOT THE APPROVAL GATE
 * --------------------------------------------
 * Capture is a property of the TURN, not of authorization — exactly like the git
 * substrate, which snapshots the working tree at the turn boundary regardless of
 * how or whether a tool was gated. File review opens even under the global bypass
 * (`spec.auto_approve_all`), where the approval gate is not installed at all, so
 * sourcing the before-bytes from the gate would let gitignored edits silently
 * escape review under auto-approve-all. Observing at the backend keeps CAS
 * capture gate-independent, so it is symmetric with the git-tracked path.
 *
 * THE SHELL IS STIGMER'S
 * ----------------------
 * {@link CasCaptureShellBackend.execute} overrides deepagents' with the
 * runner's command runner (`shared/shell/run-command.ts`): a process group,
 * the output kept on a timeout, no hang on an orphan holding the pipes
 * (stigmer#2432). The agent's `execute` tool runs the same runner through
 * {@link CasCaptureShellBackend.runShell}, streaming and under the turn's
 * stop (`shell-tool.ts`); this override is for any path that still reaches
 * the backend's own `execute`.
 *
 * SHELL VS PLAN MODE
 * ------------------
 * Outside plan mode the harness uses {@link CasCaptureShellBackend} (deepagents
 * LocalShellBackend + CAS observation) so the `execute` tool is available and
 * approval-gated. Plan mode keeps {@link CasCaptureFilesystemBackend} because
 * deepagents rejects filesystem `permissions` combined with an execution-capable
 * backend — plan mode is read-only by construction, so no shell tool there.
 *
 * The observed mutations are `write` (create, or since deepagents 1.12 a
 * whole-file overwrite — `recordBefore` reads the existing bytes either way)
 * and `edit` (modify), so this observes CREATE and MODIFY. deepagents 1.13
 * added a recursive backend `delete` and a `delete` tool over it; the native
 * harness does not expose that tool (`deepagents-profiles.ts`), and these
 * backends refuse a backend delete outright, so a graph whose model no profile
 * resolves cannot delete a subtree behind the observer's back. Deleting stays
 * on the shell (`rm`), which the approval gate holds as always, and a
 * delete-category tool from elsewhere has its before-bytes recorded by the gate
 * at authorization time (`captureDeleteBefore`, issue #303).
 *
 * VIRTUAL ROOT — THE ONE PATH DIALECT (issue #754)
 * ------------------------------------------------
 * Every backend here is constructed with `virtualMode: true`: a leading "/"
 * denotes the WORKSPACE ROOT, traversal (`..`, `~`) is rejected, and every
 * resolution stays inside `rootDir` by construction. This is the same dialect
 * the rest of the harness already speaks — the system prompt's path-resolution
 * directive, `resolveWorkspacePath(..., virtualRoot=true)` in the CAS observer
 * and turn-boundary capture, and the approval
 * gate's capturability checks. Before this flag, deepagents' legacy default
 * passed absolute paths through to the REAL filesystem: a `write_file("/tmp/x")`
 * escaped the session workspace onto the host AND escaped review entirely
 * (auto-approved as capture-mode flow, but the observer and boundary both
 * looked inside the workspace and found nothing). Read-side, the same legacy
 * pass-through was why plan mode needed rule-based read fencing at all. Do not
 * remove this flag: workspace confinement is structural, not policy.
 */

import { FilesystemBackend, LocalShellBackend } from "deepagents";
import type { DeleteResult, ExecuteResponse, LocalShellBackendOptions } from "deepagents";
import type { CasCaptureObserver } from "./cas-capture-observer.js";
import { endingOf, formatCommandOutput, runCommand, type CommandResult, type RunCommandOptions } from "../../shared/shell/run-command.js";

/** deepagents' default shell timeout, in seconds: the bound of a command the model did not raise. */
export const DEFAULT_SHELL_TIMEOUT_SECONDS = 120;

export type { CasBeforeMap } from "./cas-capture-observer.js";

type FilesystemBackendOptions = NonNullable<
  ConstructorParameters<typeof FilesystemBackend>[0]
>;

type CasCaptureDeps = { readonly observer: CasCaptureObserver };

function refusedDelete(filePath: string): DeleteResult {
  return {
    error: `Error: deleting '${filePath}' through the file tools is not available; use the shell (rm)`,
  };
}

export class CasCaptureFilesystemBackend extends FilesystemBackend {
  private readonly observer: CasCaptureObserver;

  constructor(options: FilesystemBackendOptions, deps: CasCaptureDeps) {
    super(options);
    this.observer = deps.observer;
  }

  override async write(filePath: string, content: string) {
    await this.observer.recordBefore(filePath);
    return super.write(filePath, content);
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ) {
    await this.observer.recordBefore(filePath);
    return super.edit(filePath, oldString, newString, replaceAll);
  }

  override async delete(filePath: string): Promise<DeleteResult> {
    return refusedDelete(filePath);
  }
}

/** What one command run through the backend may set: its bound, the turn's stop, and a listener for its output. */
export type ShellRunOptions = Pick<RunCommandOptions, "timeoutSeconds" | "signal" | "onOutput">;

export class CasCaptureShellBackend extends LocalShellBackend {
  private readonly observer: CasCaptureObserver;
  /** The command's whole environment, as deepagents' own backend would hand it (no inheritance). */
  private readonly shellEnv: Record<string, string>;
  /** The bound of the backend's own `execute`, deepagents' `timeout` option (seconds). */
  private readonly timeoutSeconds: number;

  constructor(options: LocalShellBackendOptions, deps: CasCaptureDeps) {
    super(options);
    this.observer = deps.observer;
    this.shellEnv = options.env ?? {};
    this.timeoutSeconds = options.timeout ?? DEFAULT_SHELL_TIMEOUT_SECONDS;
  }

  /** Run one command in the workspace with the backend's environment (`shared/shell/run-command.ts`). */
  runShell(command: string, options: ShellRunOptions): Promise<CommandResult> {
    return runCommand({ command, cwd: this.cwd, env: this.shellEnv, ...options });
  }

  /** deepagents' `execute`, on the runner's command runner at the backend's bound, in deepagents' words. */
  override async execute(command: string): Promise<ExecuteResponse> {
    if (!command || typeof command !== "string") {
      return { output: "Error: Command must be a non-empty string.", exitCode: 1, truncated: false };
    }
    const result = await this.runShell(command, { timeoutSeconds: this.timeoutSeconds });
    const ending = endingOf(result, this.timeoutSeconds);
    const output = formatCommandOutput(result);
    switch (ending.kind) {
      case "exited":
        return { output, exitCode: ending.exitCode, truncated: result.truncated };
      case "timed-out":
        return {
          output: `${output.trimEnd()}\n\nError: Command timed out after ${ending.timeoutSeconds} seconds; its processes were stopped.`,
          exitCode: 124,
          truncated: result.truncated,
        };
      /* v8 ignore start -- @preserve: this door takes no signal, so only its timeout stops a command; the agent's tool is the door the turn's stop reaches */
      case "stopped":
        return { output: `${output.trimEnd()}\n\nCommand stopped with the turn.`, exitCode: 130, truncated: result.truncated };
      /* v8 ignore stop */
      case "spawn-failed":
        return { output: `Error executing command: ${ending.message}`, exitCode: 1, truncated: false };
      /* v8 ignore start -- @preserve: the never arm; the compiler proves no ending reaches it */
      default: {
        const exhaustive: never = ending;
        throw new Error(`CasCaptureShellBackend: unknown command ending ${JSON.stringify(exhaustive)}`);
      }
      /* v8 ignore stop */
    }
  }

  override async write(filePath: string, content: string) {
    await this.observer.recordBefore(filePath);
    return super.write(filePath, content);
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ) {
    await this.observer.recordBefore(filePath);
    return super.edit(filePath, oldString, newString, replaceAll);
  }

  override async delete(filePath: string): Promise<DeleteResult> {
    return refusedDelete(filePath);
  }
}

export type CasCaptureBackend = CasCaptureFilesystemBackend | CasCaptureShellBackend;

export interface CreateCasCaptureBackendOptions {
  readonly rootDir: string;
  readonly observer: CasCaptureObserver;
  /** When set, builds a shell-capable backend with this env for `execute`. */
  readonly shellEnv?: Record<string, string>;
}

/**
 * Construct the CAS-observing backend for a deepagents agent graph.
 *
 * Shell-capable when `shellEnv` is provided; otherwise filesystem-only (plan mode).
 * Shell backends honor LocalShellBackend's documented initialize contract.
 */
export async function createCasCaptureBackend(
  options: CreateCasCaptureBackendOptions,
): Promise<CasCaptureBackend> {
  const { rootDir, observer, shellEnv } = options;

  if (shellEnv !== undefined) {
    const backend = new CasCaptureShellBackend(
      { rootDir, virtualMode: true, env: shellEnv },
      { observer },
    );
    await backend.initialize();
    return backend;
  }

  return new CasCaptureFilesystemBackend({ rootDir, virtualMode: true }, { observer });
}
