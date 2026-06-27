/**
 * Unit tests for the unified file-modifying-tool introspection.
 *
 * This module is the single source of truth both harnesses' gate capture now
 * shares, so these pin the cross-taxonomy field coverage AND the load-bearing
 * guardrail: whole-file content (`content`/`contents`/`file_content`) must stay
 * strictly separate from an edit's replacement (`new_string`/…). Conflating them
 * would make an edit look like a whole-file capture and read the wrong `before`.
 */

import { describe, it, expect } from "vitest";
import {
  isFileModifyingTool,
  extractFilePath,
  extractWriteContent,
  extractEditOldString,
  extractEditNewString,
} from "../file-tools.js";

describe("isFileModifyingTool", () => {
  it("recognizes the native (deepagents) taxonomy", () => {
    for (const name of ["write_file", "edit_file", "create_file", "write", "edit", "create", "str_replace_editor"]) {
      expect(isFileModifyingTool(name), name).toBe(true);
    }
  });

  it("recognizes the Cursor taxonomy (hook + SDK names)", () => {
    for (const name of ["Write", "StrReplace", "EditNotebook"]) {
      expect(isFileModifyingTool(name), name).toBe(true);
    }
  });

  it("excludes read-only, delete, and unknown tools (no content/hunk to preview)", () => {
    for (const name of ["read", "Read", "delete", "Delete", "shell", "Shell", "grep", "mystery"]) {
      expect(isFileModifyingTool(name), name).toBe(false);
    }
  });
});

describe("extractFilePath", () => {
  it("spans both taxonomies' path fields, including notebook target", () => {
    expect(extractFilePath({ path: "a.ts" })).toBe("a.ts");
    expect(extractFilePath({ file_path: "b.ts" })).toBe("b.ts");
    expect(extractFilePath({ target_notebook: "nb.ipynb" })).toBe("nb.ipynb");
  });

  it("returns null when no recognized path key is present", () => {
    expect(extractFilePath({ content: "no path here" })).toBeNull();
    expect(extractFilePath({})).toBeNull();
  });
});

describe("extractWriteContent (whole-file body)", () => {
  it("reads the whole-file content fields and preserves an empty file", () => {
    expect(extractWriteContent({ content: "x" })).toBe("x");
    expect(extractWriteContent({ contents: "y" })).toBe("y");
    expect(extractWriteContent({ file_content: "z" })).toBe("z");
    expect(extractWriteContent({ content: "" })).toBe(""); // empty file is real
  });

  it("GUARDRAIL: never treats an edit's new_string as whole-file content", () => {
    // An edit fragment must NOT be picked up here, or the gate would read the
    // wrong before and mislabel an edit as a whole-file rewrite.
    expect(extractWriteContent({ new_string: "frag" })).toBeNull();
    expect(extractWriteContent({ old_string: "a", new_string: "b" })).toBeNull();
    expect(extractWriteContent({ replacement: "r" })).toBeNull();
  });
});

describe("extractEditOldString / extractEditNewString (edit fragments)", () => {
  it("reads the old/new replacement fields across variants", () => {
    expect(extractEditOldString({ old_string: "a" })).toBe("a");
    expect(extractEditOldString({ old_text: "a" })).toBe("a");
    expect(extractEditOldString({ oldText: "a" })).toBe("a");
    expect(extractEditNewString({ new_string: "b" })).toBe("b");
    expect(extractEditNewString({ new_text: "b" })).toBe("b");
    expect(extractEditNewString({ newText: "b" })).toBe("b");
    expect(extractEditNewString({ replacement: "b" })).toBe("b");
  });

  it("preserves an empty string (insertion / deletion fragments)", () => {
    expect(extractEditOldString({ old_string: "" })).toBe(""); // insertion
    expect(extractEditNewString({ new_string: "" })).toBe(""); // deletion
  });

  it("returns null when the fragment is absent", () => {
    expect(extractEditOldString({ content: "whole" })).toBeNull();
    expect(extractEditNewString({ content: "whole" })).toBeNull();
  });
});
