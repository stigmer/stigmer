/**
 * The executable rule both the runner's trees and the server's file table
 * read: a script extension or a leading `#!`, nothing else.
 */
import { describe, expect, it } from "vitest";

import { entryFileMode, isExecutableEntry } from "../entry-mode.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("isExecutableEntry", () => {
  it("reads a script extension as executable whatever the bytes", () => {
    for (const path of ["run.sh", "a/b.py", "x.js", "x.ts", "x.rb", "x.pl"]) {
      expect(isExecutableEntry(path, bytes("plain")), path).toBe(true);
    }
  });

  it("reads a leading shebang as executable on any name", () => {
    expect(isExecutableEntry("hooks/check", bytes("#!/bin/sh\necho"))).toBe(true);
  });

  it("reads anything else as a plain file", () => {
    expect(isExecutableEntry("SKILL.md", bytes("# Skill"))).toBe(false);
    expect(isExecutableEntry("hooks/check", bytes("#"))).toBe(false);
    expect(isExecutableEntry("empty", new Uint8Array())).toBe(false);
    expect(isExecutableEntry("notes.SH.txt", bytes("x"))).toBe(false);
  });
});

describe("entryFileMode", () => {
  it("writes 0755 for an executable entry and 0644 otherwise", () => {
    expect(entryFileMode("run.sh", bytes("x"))).toBe(0o755);
    expect(entryFileMode("SKILL.md", bytes("x"))).toBe(0o644);
  });
});
