// Command-level contract for the named-backend surface (O3):
// add/use/list/remove over the real config file (HOME redirected to a
// throwaway dir), the reserved-name refusals, and the remove-current guard.
// The model-level semantics (migration, resolution, credentials) are pinned
// in config.test.ts / resolve.test.ts — this file pins the command layer's
// own rules.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "../../config/index.js";
import { classify, ExitCode } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "stigmer-backend-cmd-"));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
}

async function run(...args: string[]): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  const outSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync(["node", "stigmer", "config", "backend", ...args]);
    return { exitCode: ExitCode.Success, message: "" };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("config backend add/use/list/remove", () => {
  it("add persists a selfhost entry with its endpoint and api key", async () => {
    const outcome = await run(
      "add",
      "staging",
      "--endpoint",
      "stigmer.example.com:7234",
      "--api-key",
      "stk_x",
    );
    expect(outcome.exitCode).toBe(ExitCode.Success);
    const config = load();
    expect(config.backends?.["staging"]).toEqual({
      type: "selfhost",
      endpoint: "stigmer.example.com:7234",
      api_key: "stk_x",
    });
    // Adding never switches — the user opts in with `use`.
    expect(config.current_backend).toBe("local");
  });

  it("add updates an existing entry without dropping its credential", async () => {
    await run("add", "staging", "--endpoint", "old:7234", "--api-key", "stk_x");
    await run("add", "staging", "--endpoint", "new:7234");
    const entry = load().backends?.["staging"];
    expect(entry?.endpoint).toBe("new:7234");
    expect(entry?.api_key).toBe("stk_x");
  });

  it("use switches the current backend; unknown names refuse", async () => {
    await run("add", "staging", "--endpoint", "host:7234");
    expect((await run("use", "staging")).exitCode).toBe(ExitCode.Success);
    expect(load().current_backend).toBe("staging");

    const unknown = await run("use", "nope");
    expect(unknown.exitCode).toBe(ExitCode.Usage);
    expect(unknown.message).toContain('unknown backend "nope"');
  });

  it("the local name is reserved: add and remove refuse it", async () => {
    const add = await run("add", "local", "--endpoint", "host:7234");
    expect(add.exitCode).toBe(ExitCode.Usage);
    const remove = await run("remove", "local");
    expect(remove.exitCode).toBe(ExitCode.Usage);
  });

  it("remove refuses the current backend and deletes others", async () => {
    await run("add", "staging", "--endpoint", "host:7234");
    await run("use", "staging");

    const current = await run("remove", "staging");
    expect(current.exitCode).toBe(ExitCode.Usage);
    expect(current.message).toContain("current backend");

    await run("use", "local");
    expect((await run("remove", "staging")).exitCode).toBe(ExitCode.Success);
    expect(load().backends?.["staging"]).toBeUndefined();
  });

  it("set cloud seeds and selects the reserved cloud entry (legacy sugar)", async () => {
    expect((await run("set", "cloud")).exitCode).toBe(ExitCode.Success);
    const config = load();
    expect(config.current_backend).toBe("cloud");
    expect(config.backends?.["cloud"]?.endpoint).toBe("api.stigmer.ai:443");
    expect((await run("set", "local")).exitCode).toBe(ExitCode.Success);
    expect(load().current_backend).toBe("local");
  });
});
