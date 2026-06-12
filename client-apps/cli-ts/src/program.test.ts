import { describe, expect, it } from "vitest";
import { buildProgram } from "./program.js";
import { VERSION } from "./version.js";

describe("buildProgram", () => {
  it("registers the foundational commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toContain("version");
    expect(names).toContain("completion");
  });

  it("exposes the global flags as persistent options", () => {
    const program = buildProgram();
    const longFlags = program.options.map((option) => option.long);
    expect(longFlags).toEqual(
      expect.arrayContaining(["--debug", "--standalone", "--org", "--api-key"]),
    );
  });

  it("reports a semver-shaped version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
