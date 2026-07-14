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
 * deepagents mutates only via `write` (create/overwrite) and `edit` (modify);
 * there is no backend delete/rename, so this observes CREATE and MODIFY. A
 * gitignored delete can only arrive via shell, which stays on the approval gate.
 *
 * @since File-Change HITL Redesign (Phase 3 — CAS deep-agent wiring); sub-agent
 * gitignored capture parity (Session 26, DD-19); shell restore (issue #248)
 */

import { FilesystemBackend, LocalShellBackend } from "deepagents";
import type { LocalShellBackendOptions } from "deepagents";
import type { CasCaptureObserver } from "./cas-capture-observer.js";

export type { CasBeforeMap } from "./cas-capture-observer.js";

type FilesystemBackendOptions = NonNullable<
  ConstructorParameters<typeof FilesystemBackend>[0]
>;

type CasCaptureDeps = { readonly observer: CasCaptureObserver };

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
      { rootDir, env: shellEnv },
      { observer },
    );
    await backend.initialize();
    return backend;
  }

  return new CasCaptureFilesystemBackend({ rootDir }, { observer });
}
