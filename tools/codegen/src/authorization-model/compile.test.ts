// Pins the model compiler (compile.ts) and its CLI (main.ts):
//   - a two-module fixture compiles to exactly the JSON below, so an
//     upgrade of OpenFGA's parser that changes its output fails here
//     before it reaches the committed model (the dependency is pinned
//     exactly for the same reason);
//   - every parser error is reported at its file, line and column, for
//     validation errors, syntax errors and the `fga.mod` itself;
//   - a `.fga` file `fga.mod` does not list is refused, never left out;
//   - the CLI writes the canonical file, and `--check` passes on it and
//     fails on a one-byte drift, a stale file and a missing one. The CLI
//     runs as a child process, so its real argument parsing, output and
//     exit codes are what is pinned.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { formatCanonical } from "./canonical.js";
import { ModelCompileError, compileModelDir, compileModules } from "./compile.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MOD = "schema: '1.2'\ncontents:\n  - core.fga\n  - docs/doc.fga\n";

const FILES: Readonly<Record<string, string>> = {
  "core.fga": [
    "module core",
    "",
    "type user",
    "",
    "type org",
    "  relations",
    "    define owner: [user]",
    "    define member: [user] or owner",
    "",
  ].join("\n"),
  "docs/doc.fga": [
    "module docs",
    "",
    "type doc",
    "  relations",
    "    define org: [org]",
    "    define editor: [user, org#member] or owner from org",
    "    define viewer: editor and member from org",
    "",
  ].join("\n"),
};

/** The fixture's compiled model, in canonical form: every rewrite form the server evaluates. */
const EXPECTED = {
  schema_version: "1.2",
  type_definitions: [
    {
      metadata: { module: "core", source_info: { file: "core.fga" } },
      type: "user",
    },
    {
      metadata: {
        module: "core",
        relations: {
          member: { directly_related_user_types: [{ type: "user" }] },
          owner: { directly_related_user_types: [{ type: "user" }] },
        },
        source_info: { file: "core.fga" },
      },
      relations: {
        member: {
          union: { child: [{ this: {} }, { computedUserset: { relation: "owner" } }] },
        },
        owner: { this: {} },
      },
      type: "org",
    },
    {
      metadata: {
        module: "docs",
        relations: {
          editor: {
            directly_related_user_types: [{ type: "user" }, { relation: "member", type: "org" }],
          },
          org: { directly_related_user_types: [{ type: "org" }] },
          viewer: {},
        },
        source_info: { file: "docs/doc.fga" },
      },
      relations: {
        editor: {
          union: {
            child: [
              { this: {} },
              {
                tupleToUserset: {
                  computedUserset: { relation: "owner" },
                  tupleset: { relation: "org" },
                },
              },
            ],
          },
        },
        org: { this: {} },
        viewer: {
          intersection: {
            child: [
              { computedUserset: { relation: "editor" } },
              {
                tupleToUserset: {
                  computedUserset: { relation: "member" },
                  tupleset: { relation: "org" },
                },
              },
            ],
          },
        },
      },
      type: "doc",
    },
  ],
};

function readFixture(name: string): string {
  const contents = FILES[name];
  if (contents === undefined) {
    throw new Error(`fixture has no ${name}`);
  }
  return contents;
}

/** The problems a compile reports, or a failure when it compiles. */
function problemsOf(compile: () => unknown): ReadonlyArray<string> {
  try {
    compile();
  } catch (error) {
    if (error instanceof ModelCompileError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error("expected the model not to compile");
}

const tempDirs: string[] = [];

/** A model directory on disk holding the fixture, plus any extra files. */
function fixtureDir(extra: Readonly<Record<string, string>> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authz-model-"));
  tempDirs.push(dir);
  for (const [name, contents] of Object.entries({ "fga.mod": MOD, ...FILES, ...extra })) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("compileModules", () => {
  it("compiles a two-module model to OpenFGA's JSON", () => {
    expect(JSON.parse(formatCanonical(compileModules(MOD, readFixture)))).toEqual(EXPECTED);
  });

  it("reports a validation error at its file, line and column", () => {
    const broken = (name: string): string =>
      name === "core.fga" ? readFixture(name).replace("or owner", "or ownr") : readFixture(name);
    expect(problemsOf(() => compileModules(MOD, broken))).toEqual([
      "core.fga:8:30: the relation `ownr` does not exist.",
    ]);
  });

  it("reports a syntax error at its file, and every error in one run", () => {
    const broken = (name: string): string =>
      name === "core.fga"
        ? readFixture(name).replace("define owner: [user]", "define owner [user]")
        : readFixture(name).replace("[org]", "[orgg]");
    const problems = problemsOf(() => compileModules(MOD, broken));
    expect(problems[0]).toBe("core.fga:7:18: missing ':' at '['");
    expect(problems.some((line) => line.startsWith("docs/doc.fga:5:"))).toBe(true);
  });

  it("reports an fga.mod the parser refuses", () => {
    expect(
      problemsOf(() => compileModules(MOD.replace("'1.2'", "'1.3'"), readFixture)),
    ).toEqual(["fga.mod:1:9: unsupported schema version, fga.mod only supported in version `1.2`"]);
  });
});

describe("compileModelDir", () => {
  it("compiles the model on disk", () => {
    expect(JSON.parse(formatCanonical(compileModelDir(fixtureDir())))).toEqual(EXPECTED);
  });

  it("refuses a .fga file fga.mod does not list", () => {
    const dir = fixtureDir({ "docs/draft.fga": "module docs\n\ntype draft\n" });
    expect(problemsOf(() => compileModelDir(dir))).toEqual([
      "docs/draft.fga: not listed in fga.mod, so the parser would leave it out",
    ]);
  });
});

describe("the CLI", () => {
  function run(...args: ReadonlyArray<string>): { code: number | null; out: string; err: string } {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join(HERE, "main.ts"), ...args], {
      cwd: HERE,
      encoding: "utf8",
    });
    return { code: result.status, out: result.stdout, err: result.stderr };
  }

  it("writes the canonical file, and --check passes on it", () => {
    const dir = fixtureDir();
    const out = path.join(dir, "authorization-model.json");
    expect(run("--model-dir", dir, "--out", out).code).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toBe(formatCanonical(EXPECTED));
    const check = run("--model-dir", dir, "--out", out, "--check");
    expect(check.code).toBe(0);
    expect(check.out).toBe("✓ Authorization model JSON is up to date\n");
  });

  it("--check fails on a one-byte drift, a stale file and a missing one", () => {
    const dir = fixtureDir();
    const out = path.join(dir, "authorization-model.json");
    expect(run("--model-dir", dir, "--out", out).code).toBe(0);

    fs.writeFileSync(out, fs.readFileSync(out, "utf8").replace('"owner"', '"ownex"'));
    const drift = run("--model-dir", dir, "--out", out, "--check");
    expect(drift.code).toBe(1);
    expect(drift.err).toBe(`error: ${out} is stale — run 'make gen-authorization-model'\n`);

    expect(run("--model-dir", dir, "--out", out).code).toBe(0);
    fs.appendFileSync(path.join(dir, "core.fga"), "    define admin: [user]\n");
    expect(run("--model-dir", dir, "--out", out, "--check").code).toBe(1);

    fs.rmSync(out);
    const missing = run("--model-dir", dir, "--out", out, "--check");
    expect(missing.code).toBe(1);
    expect(missing.err).toBe(`error: ${out} is missing — run 'make gen-authorization-model'\n`);
  });

  it("exits 1 with the located problems when the model does not compile, and 2 on a bad call", () => {
    const dir = fixtureDir({ "core.fga": readFixture("core.fga").replace("or owner", "or ownr") });
    const broken = run("--model-dir", dir, "--out", path.join(dir, "m.json"));
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("core.fga:8:30: the relation `ownr` does not exist.");
    expect(run("--model-dir", dir).code).toBe(2);
  });
});
