/**
 * A capture-mode `FilesystemBackend` that observes gitignored file mutations for
 * CAS review (design docs 08/11/12; the `.gitignored` half of apply-then-review).
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
 * THIS CLASS IS A THIN ADAPTER
 * ----------------------------
 * All capture state and logic live in the shared {@link CasCaptureObserver} (one
 * per turn). The parent graph and every sub-agent graph are each handed a backend
 * pointing at the SAME observer, so their gitignored writes compose into one CAS
 * change set with race-free first-touch-wins (see the observer's docs). This
 * backend only forwards the mutation point to the observer before delegating to
 * the base `FilesystemBackend`.
 *
 * deepagents mutates only via `write` (create/overwrite) and `edit` (modify);
 * there is no backend delete/rename, so this observes CREATE and MODIFY. A
 * gitignored delete can only arrive via shell, which stays on the approval gate.
 *
 * @since File-Change HITL Redesign (Phase 3 — CAS deep-agent wiring); sub-agent
 * gitignored capture parity (Session 26, DD-19)
 */

import { FilesystemBackend } from "deepagents";
import type { CasCaptureObserver } from "./cas-capture-observer.js";

export type { CasBeforeMap } from "./cas-capture-observer.js";

type FilesystemBackendOptions = NonNullable<
  ConstructorParameters<typeof FilesystemBackend>[0]
>;

export class CasCaptureFilesystemBackend extends FilesystemBackend {
  private readonly observer: CasCaptureObserver;

  constructor(
    options: FilesystemBackendOptions,
    deps: { readonly observer: CasCaptureObserver },
  ) {
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
