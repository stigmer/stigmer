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

  it("registers the Wave 2b read commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["search", "usage", "diff"]));
  });

  it("registers the Wave 2d artifact commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["push", "download"]));
  });

  it("registers the Wave 3c streaming commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["run", "resume", "draft"]));
  });

  it("exposes the draft subcommands", () => {
    const program = buildProgram();
    const draft = program.commands.find((command) => command.name() === "draft");
    const subs = draft?.commands.map((command) => command.name()).sort();
    expect(subs).toEqual(["agent", "mcp-server", "skill"]);
  });

  it("marks draft subcommands' --message as required", () => {
    const program = buildProgram();
    const draft = program.commands.find((command) => command.name() === "draft");
    const skill = draft?.commands.find((command) => command.name() === "skill");
    const message = skill?.options.find((option) => option.long === "--message");
    expect(message?.required).toBe(true);
  });

  it("exposes the usage subcommands", () => {
    const program = buildProgram();
    const usage = program.commands.find((command) => command.name() === "usage");
    const subs = usage?.commands.map((command) => command.name()).sort();
    expect(subs).toEqual(["agent", "org", "session"]);
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
