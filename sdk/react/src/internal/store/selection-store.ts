/**
 * Discriminated union for a selected thread item.
 *
 * Mirrors the `ThreadItem.kind` from `MessageThread` but carries
 * only the identifying key — not the full data. The `InspectTab`
 * derives display detail from the execution snapshot separately.
 */
export type SelectedThreadItem =
  | { readonly kind: "tool-call"; readonly toolCallId: string }
  | { readonly kind: "sub-agent"; readonly subAgentId: string }
  | { readonly kind: "artifact"; readonly artifactKey: string }
  | { readonly kind: "write-back"; readonly workspaceEntryName: string };

type Listener = () => void;

/**
 * Framework-agnostic store for thread item selection.
 *
 * Implements the `useSyncExternalStore` contract identical to
 * {@link ConversationStore} and `WorkflowExecutionEventStore`.
 *
 * **Render isolation strategy:** consumers subscribe to a
 * per-item boolean via `isSelected(id)`, so only the previously-
 * and newly-selected leaves re-render on a selection change (≤2).
 *
 * The context carries the **store instance (stable ref)**, not the
 * value — so the context provider never triggers consumer re-renders.
 */
export class SelectionStore {
  private _selected: SelectedThreadItem | null = null;
  private _listeners = new Set<Listener>();

  // -- Mutations -----------------------------------------------------------

  select(item: SelectedThreadItem): void {
    if (selectedEqual(this._selected, item)) return;
    this._selected = item;
    this._notify();
  }

  deselect(): void {
    if (this._selected === null) return;
    this._selected = null;
    this._notify();
  }

  toggle(item: SelectedThreadItem): void {
    if (selectedEqual(this._selected, item)) {
      this.deselect();
    } else {
      this.select(item);
    }
  }

  // -- useSyncExternalStore contract ---------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** Returns the full selection object (for the InspectTab). */
  getSelection = (): SelectedThreadItem | null => {
    return this._selected;
  };

  /**
   * Per-item boolean selector. Each selectable leaf calls this inside
   * `useSyncExternalStore` so it only re-renders when its own
   * selected state changes.
   */
  isSelected = (kind: SelectedThreadItem["kind"], id: string): boolean => {
    if (this._selected === null) return false;
    return this._selected.kind === kind && itemId(this._selected) === id;
  };

  // -- Internal ------------------------------------------------------------

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemId(item: SelectedThreadItem): string {
  switch (item.kind) {
    case "tool-call":
      return item.toolCallId;
    case "sub-agent":
      return item.subAgentId;
    case "artifact":
      return item.artifactKey;
    case "write-back":
      return item.workspaceEntryName;
  }
}

function selectedEqual(
  a: SelectedThreadItem | null,
  b: SelectedThreadItem | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.kind === b.kind && itemId(a) === itemId(b);
}
