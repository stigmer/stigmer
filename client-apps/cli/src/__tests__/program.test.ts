import { describe, expect, it } from "vitest";
import { buildProgram, RETIRED_COMMANDS } from "../program.js";
import { VERSION } from "../version.js";

describe("buildProgram", () => {
  it("registers the foundational commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toContain("version");
    expect(names).toContain("completion");
  });

  it("registers the read commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["search", "usage", "diff"]));
  });

  it("registers the artifact commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["push", "download"]));
  });

  it("registers the streaming commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["run", "resume"]));
  });

  it("has no draft command: a plugin is authored outside Stigmer and installed, never drafted by a system agent", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).not.toContain("draft");
  });

  it("exposes the share subcommands", () => {
    const program = buildProgram();
    const share = program.commands.find((command) => command.name() === "share");
    const subs = share?.commands.map((command) => command.name());
    expect(subs).toEqual(["agent"]);
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

  it("exposes the runs subcommands", () => {
    const program = buildProgram();
    const runs = program.commands.find((command) => command.name() === "runs");
    const subs = runs?.commands.map((command) => command.name()).sort();
    expect(subs).toEqual(["approve", "cancel", "logs", "pause", "resume", "terminate", "trace"]);
  });

  it("has no execution group: runs replaced it, and the old word is not an alias", () => {
    const program = buildProgram();
    const names = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
    expect(names).not.toContain("execution");
  });

  it("answers the retired execution group with one line pointing at runs", async () => {
    const program = buildProgram();
    let stderr = "";
    program.exitOverride().configureOutput({ writeErr: (text) => void (stderr += text) });
    await expect(program.parseAsync(["execution", "logs", "aex_1"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr).toContain("unknown command 'execution'");
    expect(stderr).toContain(`${RETIRED_COMMANDS.get("execution")}\n`);
    expect(stderr).toContain("stigmer runs");
  });

  it("leaves an unknown command that never existed without a pointer", async () => {
    const program = buildProgram();
    let stderr = "";
    program.exitOverride().configureOutput({ writeErr: (text) => void (stderr += text) });
    await expect(program.parseAsync(["nonsense"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr).not.toContain("stigmer runs");
  });

  it("reports a semver-shaped version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
