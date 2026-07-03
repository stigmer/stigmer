// The set of workspace files open in the surface's editor group, plus which is
// active — the VS Code "open editors" model. Sibling to
// WorkspaceFileSelectionStore (which stays the single-file selection used by the
// launcher's Viewer tab); this store owns the multi-tab surface. Its active
// editor derives the same SelectedWorkspaceFile shape, so downstream diff
// correlation and tree highlight consume one selection regardless of source.

import type { SelectedWorkspaceFile } from "./workspace-file-selection-store.js";

/**
 * One open editor tab.
 *
 * `preview` marks the single reusable "preview" tab (shown in italics): a
 * single click opens or replaces it in place, so casual browsing never
 * accumulates tabs. Pinning it (double-click, or opening the file explicitly)
 * clears the flag and the tab becomes persistent. At most one editor is a
 * preview at any time.
 */
export interface OpenEditor {
  /** Stable-within-page id of the owning workspace entry. */
  readonly entryId: string;
  /** Repo-relative (git) or root-relative (local) file path. */
  readonly path: string;
  /** Whether this is the reusable preview tab (italic, single per group). */
  readonly preview: boolean;
}

/** Immutable snapshot for the `useSyncExternalStore` contract. */
export interface WorkspaceEditorsSnapshot {
  /** Open editors in tab order. */
  readonly editors: readonly OpenEditor[];
  /** Key of the active editor, or `null` when the group is empty. */
  readonly activeKey: string | null;
  /**
   * The active editor as a {@link SelectedWorkspaceFile} (stable ref between
   * mutations), or `null`. This is what the viewer, diff correlation, and tree
   * highlight consume — the editors store's projection into the selection shape.
   */
  readonly activeFile: SelectedWorkspaceFile | null;
}

type Listener = () => void;

const EMPTY_SNAPSHOT: WorkspaceEditorsSnapshot = {
  editors: [],
  activeKey: null,
  activeFile: null,
};

/**
 * Stable key for an editor. Uses NUL as the separator — legal in neither an
 * entry id nor a file path — so `entryId`/`path` can never collide.
 */
export function editorKey(entryId: string, path: string): string {
  return `${entryId}\u0000${path}`;
}

/**
 * Framework-agnostic store for the surface's open-editor group.
 *
 * Implements the `useSyncExternalStore` contract like the sibling selection and
 * conversation stores: the context/ref carries the instance, and `getSnapshot`
 * returns a snapshot object that is replaced only inside a mutation — so it is a
 * stable reference between mutations and never triggers a render loop.
 *
 * VS Code preview-tab semantics:
 * - {@link openPreview} — single click: reuse the one preview slot (or focus an
 *   already-open editor); casual browsing stays at one tab.
 * - {@link openPinned} / {@link pin} — double-click or explicit open: the tab
 *   becomes persistent.
 * - {@link close} — remove a tab, activating a neighbor.
 * - {@link activate} — focus an already-open tab.
 */
export class WorkspaceEditorsStore {
  private _snapshot: WorkspaceEditorsSnapshot = EMPTY_SNAPSHOT;
  private _listeners = new Set<Listener>();

  // -- Mutations -----------------------------------------------------------

  /** Single-click open: reuse the preview slot, or focus if already open. */
  openPreview(entryId: string, path: string): void {
    const key = editorKey(entryId, path);
    const { editors } = this._snapshot;

    if (editors.some((e) => editorKey(e.entryId, e.path) === key)) {
      // Already open — focus it, preserving its pinned/preview state.
      this._setActive(key);
      return;
    }

    const next = { entryId, path, preview: true };
    const previewIndex = editors.findIndex((e) => e.preview);
    const editorsNext =
      previewIndex >= 0
        ? editors.map((e, i) => (i === previewIndex ? next : e))
        : [...editors, next];
    this._commit(editorsNext, key);
  }

  /** Explicit open (double-click / open-to-keep): a persistent tab. */
  openPinned(entryId: string, path: string): void {
    const key = editorKey(entryId, path);
    const { editors } = this._snapshot;
    const index = editors.findIndex((e) => editorKey(e.entryId, e.path) === key);

    if (index >= 0) {
      if (editors[index].preview) {
        this._commit(
          editors.map((e, i) => (i === index ? { ...e, preview: false } : e)),
          key,
        );
      } else {
        this._setActive(key);
      }
      return;
    }

    this._commit([...editors, { entryId, path, preview: false }], key);
  }

  /** Pin an open editor (clear its preview flag), keeping it active. */
  pin(entryId: string, path: string): void {
    const key = editorKey(entryId, path);
    const { editors } = this._snapshot;
    const index = editors.findIndex((e) => editorKey(e.entryId, e.path) === key);
    if (index < 0 || !editors[index].preview) return;
    this._commit(
      editors.map((e, i) => (i === index ? { ...e, preview: false } : e)),
      key,
    );
  }

  /** Focus an already-open editor. No-op if it is not open. */
  activate(entryId: string, path: string): void {
    const key = editorKey(entryId, path);
    if (!this._snapshot.editors.some((e) => editorKey(e.entryId, e.path) === key)) {
      return;
    }
    this._setActive(key);
  }

  /**
   * Close an editor. When the closed tab was active, the neighbor to its right
   * (or, failing that, its left) becomes active — matching editor conventions.
   */
  close(entryId: string, path: string): void {
    const key = editorKey(entryId, path);
    const { editors, activeKey } = this._snapshot;
    const index = editors.findIndex((e) => editorKey(e.entryId, e.path) === key);
    if (index < 0) return;

    const editorsNext = editors.filter((_, i) => i !== index);

    let nextActiveKey = activeKey;
    if (activeKey === key) {
      const neighbor = editorsNext[index] ?? editorsNext[index - 1] ?? null;
      nextActiveKey = neighbor
        ? editorKey(neighbor.entryId, neighbor.path)
        : null;
    }
    this._commit(editorsNext, nextActiveKey);
  }

  /** Close every editor. */
  closeAll(): void {
    if (this._snapshot.editors.length === 0) return;
    this._snapshot = EMPTY_SNAPSHOT;
    this._notify();
  }

  // -- useSyncExternalStore contract ---------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** Returns the current snapshot (stable ref between mutations). */
  getSnapshot = (): WorkspaceEditorsSnapshot => this._snapshot;

  // -- Internal ------------------------------------------------------------

  private _setActive(key: string | null): void {
    if (this._snapshot.activeKey === key) return;
    this._commit(this._snapshot.editors, key);
  }

  private _commit(editors: readonly OpenEditor[], activeKey: string | null): void {
    const active =
      activeKey != null
        ? editors.find((e) => editorKey(e.entryId, e.path) === activeKey) ?? null
        : null;
    this._snapshot = {
      editors,
      activeKey: active ? activeKey : null,
      activeFile: active ? { entryId: active.entryId, path: active.path } : null,
    };
    this._notify();
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}
