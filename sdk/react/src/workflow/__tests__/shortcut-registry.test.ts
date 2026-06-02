import { describe, it, expect } from "vitest";
import {
  getAllShortcuts,
  getShortcut,
  getShortcutHint,
  type ShortcutDefinition,
  type ShortcutScope,
} from "../shortcut-registry";

describe("shortcut-registry", () => {
  const all = getAllShortcuts();

  it("returns a non-empty array of definitions", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it("every definition has a unique id", () => {
    const ids = all.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every definition has non-empty id, label, keys, and hint", () => {
    for (const d of all) {
      expect(d.id).toBeTruthy();
      expect(d.label).toBeTruthy();
      expect(d.keys).toBeTruthy();
      expect(d.hint).toBeTruthy();
    }
  });

  it("every definition has a valid scope", () => {
    const validScopes: ShortcutScope[] = ["node", "edge", "selection", "canvas"];
    for (const d of all) {
      expect(validScopes).toContain(d.scope);
    }
  });

  it("every definition has a boolean requiresDesignMode", () => {
    for (const d of all) {
      expect(typeof d.requiresDesignMode).toBe("boolean");
    }
  });

  describe("getShortcut", () => {
    it("returns the definition for a known id", () => {
      const dup = getShortcut("duplicate");
      expect(dup).toBeDefined();
      expect(dup!.id).toBe("duplicate");
      expect(dup!.label).toBe("Duplicate");
    });

    it("returns undefined for an unknown id", () => {
      expect(getShortcut("nonexistent_shortcut")).toBeUndefined();
    });
  });

  describe("getShortcutHint", () => {
    it("returns a non-empty hint for known ids", () => {
      expect(getShortcutHint("duplicate")).toBeTruthy();
      expect(getShortcutHint("copy")).toBeTruthy();
      expect(getShortcutHint("paste")).toBeTruthy();
      expect(getShortcutHint("selectAll")).toBeTruthy();
      expect(getShortcutHint("undo")).toBeTruthy();
      expect(getShortcutHint("redo")).toBeTruthy();
      expect(getShortcutHint("delete")).toBeTruthy();
    });

    it("returns an empty string for unknown ids", () => {
      expect(getShortcutHint("nonexistent_shortcut")).toBe("");
    });
  });

  describe("hint platform formatting", () => {
    it("hint never contains the literal string 'Mod+'", () => {
      for (const d of all) {
        expect(d.hint).not.toContain("Mod+");
      }
    });

    it("hints contain either Mac symbols or Ctrl prefix", () => {
      for (const d of all) {
        if (d.keys.includes("Mod+")) {
          const hasMacSymbol = /[\u2318\u21E7\u2325]/.test(d.hint);
          const hasCtrl = d.hint.includes("Ctrl+");
          expect(hasMacSymbol || hasCtrl).toBe(true);
        }
      }
    });
  });

  describe("expected shortcuts are registered", () => {
    const expectedIds = [
      "duplicate",
      "copy",
      "cut",
      "paste",
      "delete",
      "addTaskAfter",
      "selectAll",
      "undo",
      "redo",
      "escape",
    ];

    it.each(expectedIds)("shortcut '%s' is registered", (id) => {
      expect(getShortcut(id)).toBeDefined();
    });
  });

  describe("scope assignments", () => {
    it("duplicate is scoped to node", () => {
      expect(getShortcut("duplicate")!.scope).toBe("node");
    });

    it("copy and cut are scoped to selection", () => {
      expect(getShortcut("copy")!.scope).toBe("selection");
      expect(getShortcut("cut")!.scope).toBe("selection");
    });

    it("paste is scoped to canvas", () => {
      expect(getShortcut("paste")!.scope).toBe("canvas");
    });

    it("delete is scoped to selection", () => {
      expect(getShortcut("delete")!.scope).toBe("selection");
    });

    it("selectAll is scoped to canvas", () => {
      expect(getShortcut("selectAll")!.scope).toBe("canvas");
    });

    it("escape does not require design mode", () => {
      expect(getShortcut("escape")!.requiresDesignMode).toBe(false);
    });
  });
});
