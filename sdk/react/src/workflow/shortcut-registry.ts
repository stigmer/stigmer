/**
 * Canonical shortcut definitions for the workflow canvas editor.
 *
 * Single source of truth for all keyboard shortcuts — consumed by
 * {@link useCanvasKeyboardShortcuts} (matching), {@link CanvasContextMenu}
 * (hint labels), {@link NodeActions} (toolbar tooltips), and any future
 * help dialog or documentation generator.
 *
 * Pure TypeScript — no React dependency. Safe to import from any layer.
 *
 * @since T11 (Context Menus and Keyboard Shortcuts)
 */

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const IS_MAC: boolean =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Where a shortcut is applicable.
 *
 * - `node` — single node selected
 * - `edge` — single edge selected
 * - `selection` — one or more nodes selected (multi-select)
 * - `canvas` — no selection required, fires on the canvas
 */
export type ShortcutScope = "node" | "edge" | "selection" | "canvas";

/** A single keyboard shortcut definition. */
export interface ShortcutDefinition {
  /** Stable identifier (e.g. `"duplicate"`, `"copy"`). */
  readonly id: string;
  /** Human-readable action label for menus and tooltips. */
  readonly label: string;
  /**
   * Key chord in platform-agnostic notation.
   *
   * `Mod` resolves to `Cmd` on macOS, `Ctrl` elsewhere.
   * Bare keys use their literal name (e.g. `"N"`, `"Escape"`).
   */
  readonly keys: string;
  /** Platform-specific display string (e.g. `"⌘D"` or `"Ctrl+D"`). */
  readonly hint: string;
  /** Where this shortcut is active. */
  readonly scope: ShortcutScope;
  /** Whether the shortcut is restricted to design mode. */
  readonly requiresDesignMode: boolean;
}

// ---------------------------------------------------------------------------
// Hint formatting
// ---------------------------------------------------------------------------

function formatHint(keys: string): string {
  if (IS_MAC) {
    return keys
      .replace(/Mod\+/g, "\u2318")
      .replace(/Shift\+/g, "\u21E7")
      .replace(/Alt\+/g, "\u2325")
      .replace(/Backspace/g, "\u232B")
      .replace(/Delete/g, "\u232B");
  }
  return keys
    .replace(/Mod\+/g, "Ctrl+")
    .replace(/Backspace/g, "Del")
    .replace(/Delete/g, "Del");
}

// ---------------------------------------------------------------------------
// Shortcut definitions
// ---------------------------------------------------------------------------

function def(
  id: string,
  label: string,
  keys: string,
  scope: ShortcutScope,
  requiresDesignMode: boolean,
): ShortcutDefinition {
  return { id, label, keys, hint: formatHint(keys), scope, requiresDesignMode };
}

const DEFINITIONS: readonly ShortcutDefinition[] = [
  // Single-node actions
  def("duplicate",       "Duplicate",         "Mod+D",           "node",      true),
  def("copy",            "Copy",              "Mod+C",           "selection", true),
  def("cut",             "Cut",               "Mod+X",           "selection", true),
  def("paste",           "Paste",             "Mod+V",           "canvas",    true),
  def("delete",          "Delete",            "Backspace",       "selection", true),
  def("addTaskAfter",    "Add task after\u2026", "N",            "node",      true),

  // Canvas-wide actions
  def("selectAll",       "Select all",        "Mod+A",           "canvas",    true),
  def("undo",            "Undo",              "Mod+Z",           "canvas",    true),
  def("redo",            "Redo",              "Mod+Shift+Z",     "canvas",    true),
  def("escape",          "Deselect",          "Escape",          "canvas",    false),
] as const;

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

const BY_ID = new Map<string, ShortcutDefinition>(
  DEFINITIONS.map((d) => [d.id, d]),
);

/** All registered shortcut definitions. */
export function getAllShortcuts(): readonly ShortcutDefinition[] {
  return DEFINITIONS;
}

/**
 * Look up a shortcut by its stable identifier.
 *
 * Returns `undefined` if the id is not registered — callers should
 * treat this as a programming error (missing registry entry).
 */
export function getShortcut(id: string): ShortcutDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * Get the display hint for a shortcut, or an empty string if not found.
 *
 * Convenience wrapper for context menu and toolbar hint labels.
 */
export function getShortcutHint(id: string): string {
  return BY_ID.get(id)?.hint ?? "";
}

/** Whether the runtime platform is macOS / iOS. */
export function isMacPlatform(): boolean {
  return IS_MAC;
}
