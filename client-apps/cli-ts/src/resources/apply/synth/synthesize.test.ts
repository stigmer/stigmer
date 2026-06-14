// Synthesize orchestration with an injected spawn: asserts the env/cwd/command
// handed to the subprocess, the per-runtime command choice, the `.stigmer`
// output dir, and the actionable errors on non-zero exit / spawn failure /
// missing inputs.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeCommand, type SpawnFn, synthesize } from "./synthesize.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "synth-exec-"));
  writeFileSync(join(dir, "index.ts"), "// entry");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ok: SpawnFn = async () => ({ exitCode: 0, stdout: "done", stderr: "" });
const noPrepare = () => {};

describe("synthesize", () => {
  it("spawns the entry point with the synthesis env and cwd, creating .stigmer", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
    const spawn: SpawnFn = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await synthesize(
      { projectDir: dir, entryPoint: "index.ts", runtime: "node", orgId: "acme" },
      { spawn, prepare: noPrepare },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("npx");
    // The entry is passed as an absolute path (npx ignores cwd for relative).
    expect(calls[0].args[0]).toBe("tsx");
    expect(isAbsolute(calls[0].args[1])).toBe(true);
    expect(calls[0].args[1].endsWith("/index.ts")).toBe(true);
    expect(calls[0].cwd).toBe(result.outputDir.replace(/\/\.stigmer$/, ""));
    expect(calls[0].env.STIGMER_OUT_DIR).toBe(result.outputDir);
    expect(calls[0].env.STIGMER_ORG_ID).toBe("acme");
    expect(result.outputDir.endsWith("/.stigmer")).toBe(true);
    expect(existsSync(result.outputDir)).toBe(true);
  });

  it("omits STIGMER_ORG_ID when no org is given", async () => {
    let env: NodeJS.ProcessEnv = {};
    const spawn: SpawnFn = async (_c, _a, options) => {
      env = options.env;
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    await synthesize({ projectDir: dir, entryPoint: "index.ts", runtime: "node", orgId: "" }, { spawn, prepare: noPrepare });
    expect(env.STIGMER_ORG_ID).toBeUndefined();
  });

  it("maps a non-zero exit to an actionable error with stderr and guidance", async () => {
    const spawn: SpawnFn = async () => ({ exitCode: 1, stdout: "", stderr: "ReferenceError: boom" });
    await expect(
      synthesize({ projectDir: dir, entryPoint: "index.ts", runtime: "node", orgId: "" }, { spawn, prepare: noPrepare }),
    ).rejects.toThrow(/SDK synthesis failed:[\s\S]*ReferenceError: boom[\s\S]*npm install/);
  });

  it("maps a spawn failure (missing binary) to an actionable error", async () => {
    const spawn: SpawnFn = async () => {
      throw new Error("spawn npx ENOENT");
    };
    await expect(
      synthesize({ projectDir: dir, entryPoint: "index.ts", runtime: "node", orgId: "" }, { spawn, prepare: noPrepare }),
    ).rejects.toThrow(/SDK synthesis failed:[\s\S]*spawn npx ENOENT/);
  });

  it("rejects a missing entry point before spawning", async () => {
    const spawn = vi.fn(ok);
    await expect(
      synthesize({ projectDir: dir, entryPoint: "missing.ts", runtime: "node", orgId: "" }, { spawn, prepare: noPrepare }),
    ).rejects.toThrow(/entry point not found/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a missing project directory", async () => {
    await expect(
      synthesize({ projectDir: join(dir, "nope"), entryPoint: "index.ts", runtime: "node", orgId: "" }, { spawn: ok }),
    ).rejects.toThrow(/project directory not found/);
  });

  it("enforces node readiness via the default prepare (node_modules missing)", async () => {
    writeFileSync(join(dir, "package.json"), "{}");
    await expect(
      synthesize({ projectDir: dir, entryPoint: "index.ts", runtime: "node", orgId: "" }, { spawn: ok }),
    ).rejects.toThrow(/node_modules not found/);
  });
});

describe("runtimeCommand", () => {
  it("chooses the runner per runtime and extension", () => {
    expect(runtimeCommand("go", "main.go")).toEqual(["go", "run", "main.go"]);
    expect(runtimeCommand("python", "main.py")).toEqual(["python3", "main.py"]);
    expect(runtimeCommand("node", "index.ts")).toEqual(["npx", "tsx", "index.ts"]);
    expect(runtimeCommand("node", "index.mts")).toEqual(["npx", "tsx", "index.mts"]);
    expect(runtimeCommand("node", "index.js")).toEqual(["node", "index.js"]);
    expect(runtimeCommand("node", "index.mjs")).toEqual(["node", "index.mjs"]);
  });
});
