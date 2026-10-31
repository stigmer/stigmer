// Proves the commands whose answer is a bare value keep printing it bare,
// pipe-friendly, and print one JSON document with -o json (CLI-02):
// `version`, `config path`, `config get` and `config list`; and that
// `access-history export`, JSON Lines in every form, refuses a table.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../program.js";
import { VERSION } from "../../version.js";

let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function cli(...args: string[]): Promise<string> {
  await buildProgram().parseAsync(["--standalone", ...args], { from: "user" });
  return stdout.join("");
}

describe("CLI-02 a command whose answer is a bare value prints JSON with -o json", () => {
  it("prints the version bare, or as {version}", async () => {
    expect(await cli("version")).toBe(`${VERSION}\n`);
    stdout = [];
    expect(JSON.parse(await cli("version", "-o", "json"))).toEqual({ version: VERSION });
  });

  it("prints a config value bare, or as {key, value}", async () => {
    const bare = await cli("config", "get", "current_backend");
    stdout = [];
    expect(JSON.parse(await cli("config", "get", "current_backend", "--json"))).toEqual({ key: "current_backend", value: bare.trimEnd() });
  });

  it("prints every config value as key=value lines, or as one object", async () => {
    const lines = (await cli("config", "list")).trimEnd().split("\n");
    stdout = [];
    const object = JSON.parse(await cli("config", "list", "-o", "json")) as Record<string, string>;
    expect(lines).toEqual(Object.entries(object).map(([key, value]) => `${key}=${value}`));
  });

  it("prints the config path bare, or as {path}", async () => {
    const bare = (await cli("config", "path")).trimEnd();
    stdout = [];
    expect(JSON.parse(await cli("config", "path", "-o", "json"))).toEqual({ path: bare });
  });

  it("refuses a table for access-history export, which writes JSON Lines only, naming only what it takes", async () => {
    for (const value of ["table", "yaml"]) {
      await expect(cli("access-history", "export", "-o", value)).rejects.toMatchObject({
        exitCode: 2,
        message: `--output ${value} is not supported by stigmer access-history export (supported: json, ndjson)`,
      });
    }
  });
});
