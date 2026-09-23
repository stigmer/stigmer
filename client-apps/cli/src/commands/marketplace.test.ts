// Command-level contract for `stigmer marketplace`: add reads the source once
// and records it under the file's own name (or --name), list is offline and
// names an unreadable entry, show lists what a marketplace offers with each
// entry's version, remove refuses the built-in name. Over the real config
// file (HOME redirected) and a local marketplace fixture; no network.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "../config/index.js";
import { classify, ExitCode } from "../errors/index.js";
import { writeCursorMarketplace } from "../marketplace/__fixtures__/cursor-marketplace.js";
import { buildProgram } from "../program.js";

let home: string;
let fixture: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "stigmer-marketplace-cmd-"));
  fixture = mkdtempSync(join(tmpdir(), "stigmer-marketplace-cmd-fixture-"));
  writeCursorMarketplace(fixture);
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(fixture, { recursive: true, force: true });
});

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(...args: string[]): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  let stderr = "";
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  try {
    await program.parseAsync(["node", "stigmer", "marketplace", ...args]);
    return { exitCode: ExitCode.Success, message: "", stdout, stderr };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
      stdout,
      stderr,
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("marketplace add", () => {
  it("reads the source, records it under the file's own name, and says what it offers", async () => {
    const outcome = await run("add", fixture, "--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    const payload = JSON.parse(outcome.stdout);
    expect(payload.message).toBe(
      `Added source 'acme-plugins' (${fixture}), offering 2 plugins`,
    );
    expect(payload.data).toEqual({
      name: "acme-plugins",
      source: { type: "local", path: fixture },
      plugins: 2,
    });
    expect(load().marketplaces?.["acme-plugins"]).toEqual({
      type: "local",
      path: fixture,
    });
  });

  it("records it under --name instead, and refuses a name outside the grammar", async () => {
    expect((await run("add", fixture, "--name", "cursor")).exitCode).toBe(
      ExitCode.Success,
    );
    expect(Object.keys(load().marketplaces ?? {})).toEqual(["cursor"]);
    const bad = await run("add", fixture, "--name", "Not Valid");
    expect(bad.exitCode).toBe(ExitCode.Usage);
    expect(bad.message).toMatch(/'Not Valid' is not a marketplace name/);
  });

  it("refuses a directory that is not a marketplace before recording anything", async () => {
    const outcome = await run("add", home);
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toMatch(/not a marketplace this CLI can read/);
    expect(load().marketplaces).toBeUndefined();
  });

  it("refuses the built-in name toward --name, takes a vendor's name, and refuses a duplicate", async () => {
    expect((await run("add", fixture, "--name", "stigmer")).message).toMatch(
      /'stigmer' is a built-in source and cannot be added or replaced[\s\S]*--name/,
    );
    // A vendor's catalogue is a source the user adds; its name is his to take.
    expect((await run("add", fixture, "--name", "cursor-plugins")).exitCode).toBe(
      ExitCode.Success,
    );
    expect(load().marketplaces?.["cursor-plugins"]).toBeDefined();
    await run("add", fixture);
    expect((await run("add", fixture)).message).toMatch(/already configured/);
  });
});

describe("marketplace list", () => {
  it("is offline, the built-in first, and names an entry it cannot read", async () => {
    await run("add", fixture);
    const { save } = await import("../config/index.js");
    const config = load();
    save({
      ...config,
      marketplaces: { ...config.marketplaces, broken: { type: "gitlab" } },
    });

    const outcome = await run("list", "--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    const payload = JSON.parse(outcome.stdout);
    expect(payload.status).toBe("warning");
    expect(payload.data.marketplaces).toEqual([
      { name: "stigmer", source: { type: "official" } },
      { name: "acme-plugins", source: { type: "local", path: fixture } },
      {
        name: "broken",
        unreadable: "unknown type 'gitlab' (expected 'github' or 'local')",
      },
    ]);
  });
});

describe("marketplace show", () => {
  it("lists the offered plugins with their manifest versions and the entries it could not offer", async () => {
    await run("add", fixture);
    const outcome = await run("show", "acme-plugins", "--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    const payload = JSON.parse(outcome.stdout);
    expect(payload.message).toBe(
      "Marketplace 'acme-plugins' offers 2 plugins, with 1 warning",
    );
    expect(payload.data.plugins).toEqual([
      {
        name: "warmer",
        dir: "warmer",
        version: "1.0.0",
        description: "The warmer plugin.",
      },
      { name: "codeforge", dir: "third_party/codeforge", version: "2.1.0" },
    ]);
    expect(payload.data.warnings).toHaveLength(1);
    expect(payload.data.warnings[0].subject).toBe("ghost");
  });

  it("shows the built-in marketplace", async () => {
    const outcome = await run("show", "stigmer", "--json");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    const payload = JSON.parse(outcome.stdout);
    expect(payload.data.marketplace.name).toBe("stigmer");
    expect(payload.data.plugins.map((p: { name: string }) => p.name)).toContain(
      "linear",
    );
  });

  it("refuses an unknown name toward list", async () => {
    const outcome = await run("show", "nope");
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toMatch(
      /no marketplace named 'nope'.*stigmer marketplace list/s,
    );
  });
});

describe("marketplace remove", () => {
  it("removes an added source and refuses a built-in and an unknown one", async () => {
    await run("add", fixture);
    expect((await run("remove", "acme-plugins")).exitCode).toBe(
      ExitCode.Success,
    );
    expect(load().marketplaces).toBeUndefined();
    expect((await run("remove", "stigmer")).message).toMatch(
      /'stigmer' is a built-in source and cannot be removed/,
    );
    expect((await run("remove", "acme-plugins")).message).toMatch(
      /no marketplace named 'acme-plugins'/,
    );
  });
});
