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
 * and turn-boundary capture, `InlinePublisher.normalizePath`, and the approval
 * gate's capturability checks. Before this flag, deepagents' legacy default
 * passed absolute paths through to the REAL filesystem: a `write_file("/tmp/x")`
 * escaped the session workspace onto the host AND escaped review entirely
 * (auto-approved as capture-mode flow, but the observer/boundary/publisher all
 * looked inside the workspace and found nothing). Read-side, the same legacy
 * pass-through was why plan mode needed rule-based read fencing at all. Do not
 * remove this flag: workspace confinement is structural, not policy.
 */

import { FilesystemBackend, LocalShellBackend } from "deepagents";
import type { DeleteResult, LocalShellBackendOptions } from "deepagents";
import type { CasCaptureObserver } from "./cas-capture-observer.js";

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

export class CasCaptureShellBackend extends LocalShellBackend {
  private readonly observer: CasCaptureObserver;

  constructor(options: LocalShellBackendOptions, deps: CasCaptureDeps) {
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
