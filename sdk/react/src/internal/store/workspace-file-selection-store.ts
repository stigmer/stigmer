// Which workspace file is open in the viewer.

/**
 * A file selected for viewing.
 *
 * Keyed by `entryId` (not the entry value): the workspace entry id is stable
 * within a page load but regenerated on reload, and selection is transient UI
 * state anyway (reset on reload). Consumers must resolve the live entry via
 * `workspace.entries.find(e => e.id === sel.entryId)` so a removed entry
 * deselects naturally instead of holding a stale value.
 */
export interface SelectedWorkspaceFile {
  /** Stable-within-page id of the owning workspace entry. */
  readonly entryId: string;
  /** Repo-relative (git) or root-relative (local) file path. */
  readonly path: string;
}

type Listener = () => void;

/**
 * Framework-agnostic store for the currently-open workspace file.
 *
 * Implements the `useSyncExternalStore` contract: the context carries the
 * store instance (stable ref), and `getSelection` returns the stored object
 * reference — a new object is allocated only inside `select` — so `getSnapshot`
 * never triggers a re-render loop.
 */
export class WorkspaceFileSelectionStore {
  private _selected: SelectedWorkspaceFile | null = null;
  private _listeners = new Set<Listener>();

  // -- Mutations -----------------------------------------------------------

  select(file: SelectedWorkspaceFile): void {
    if (selectedEqual(this._selected, file)) return;
    this._selected = file;
    this._notify();
  }

  deselect(): void {
    if (this._selected === null) return;
    this._selected = null;
    this._notify();
  }

  toggle(file: SelectedWorkspaceFile): void {
    if (selectedEqual(this._selected, file)) {
      this.deselect();
    } else {
      this.select(file);
    }
  }

  // -- useSyncExternalStore contract ---------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** Returns the current selection (stable ref between mutations). */
  getSelection = (): SelectedWorkspaceFile | null => {
    return this._selected;
  };

  // -- Internal ------------------------------------------------------------

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}

function selectedEqual(
  a: SelectedWorkspaceFile | null,
  b: SelectedWorkspaceFile | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.entryId === b.entryId && a.path === b.path;
}
