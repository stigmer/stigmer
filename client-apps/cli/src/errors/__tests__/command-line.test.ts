// Proves Commander's refusals reach the person as the CLI's own usage errors
// (../command-line.ts): `Error: ...` and the failing command's help named on
// the next line, exit 2, printed once; help and version leave with 0; a group
// run without its subcommand prints its help and exits 2; and nothing a person
// typed that may be a key is echoed (an option's value written after '=',
// an extra argument).
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { buildProgram } from "../../program.js";
import { classify } from "../classify.js";
import { formatError } from "../handle.js";

/** Parse `argv` through the whole program, returning what it printed and what it threw. */
async function parse(argv: readonly string[]): Promise<{ out: string; err: string; thrown: unknown }> {
  const program: Command = buildProgram();
  let out = "";
  let err = "";
  program.configureOutput({ writeOut: (text) => void (out += text), writeErr: (text) => void (err += text) });
  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    return { out, err, thrown: error };
  }
  return { out, err, thrown: undefined };
}

/** What the person reads on stderr for a thrown error, and the code the CLI exits with. */
function rendered(thrown: unknown): { text: string; exitCode: number } {
  const error = classify(thrown);
  if (error === null) return { text: "", exitCode: 0 };
  return { text: formatError(error, false), exitCode: error.exitCode };
}

describe("CLI-03 a usage error exits 2, in the CLI's own error style", () => {
  it("words an unknown option with Commander's suggestion and the command's help", async () => {
    const { err, thrown } = await parse(["get", "agent", "reviewer", "--outpt", "json"]);
    expect(rendered(thrown)).toEqual({
      text: "Error: unknown option '--outpt' (Did you mean --output?)\n\nRun `stigmer get --help` for usage.\n",
      exitCode: 2,
    });
    expect(err, "printed once, by the CLI's exit point").toBe("");
  });

  it("names a missing argument and the command it belongs to", async () => {
    const { thrown } = await parse(["get", "agent"]);
    expect(rendered(thrown)).toEqual({
      text: "Error: missing required argument 'reference'\n\nRun `stigmer get --help` for usage.\n",
      exitCode: 2,
    });
  });

  it("names an unknown command at the root with the root's help", async () => {
    const { thrown } = await parse(["gett", "agent", "reviewer"]);
    const { text, exitCode } = rendered(thrown);
    expect(exitCode).toBe(2);
    expect(text).toMatch(/^Error: unknown command 'gett'/);
    expect(text).toContain("Run `stigmer --help` for usage.");
  });

  it("counts extra arguments without echoing them, so a key typed in the wrong place stays off the screen", async () => {
    const planted = "sk-ant-api03-PLANTEDKEY0000000000";
    const { err, thrown } = await parse(["run", "reviewer", planted]);
    const { text, exitCode } = rendered(thrown);
    expect(exitCode).toBe(2);
    expect(text).toBe("Error: stigmer run takes 1 argument, got 2\n\nRun `stigmer run --help` for usage.\n");
    expect(text + err).not.toContain("PLANTEDKEY");
  });

  it("never echoes an option's value written after '=', and keeps only a suggestion that is an option's name", async () => {
    const { thrown } = await parse(["get", "agent", "reviewer", "--outpt=sk-live-PLANTED\n(Did you mean --leak?)"]);
    const { text } = rendered(thrown);
    expect(text).toMatch(/^Error: unknown option '--outpt'/);
    expect(text).not.toContain("PLANTED");
    expect(text).not.toContain("--leak");
  });

  it("leaves quietly with 0 on --help and --version", async () => {
    for (const argv of [["--help"], ["get", "--help"], ["--version"]]) {
      const { out, thrown } = await parse(argv);
      expect(rendered(thrown)).toEqual({ text: "", exitCode: 0 });
      expect(out).not.toBe("");
    }
  });

  it("prints a group's help to stderr and exits 2 when it is run without its subcommand", async () => {
    const { out, err, thrown } = await parse(["config"]);
    expect(rendered(thrown)).toEqual({ text: "", exitCode: 2 });
    expect(out).toBe("");
    expect(err).toContain("Usage: stigmer config");
  });
});
