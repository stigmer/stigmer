// Command-level contract for the `connect mcp-server` org guard (issue #140).
//
// Connecting pushes to the backend, which requires an org. Rather than let the
// backend reject the request with the cryptic "org value length must be at least
// 1" validation error, the command fails fast with actionable guidance — but
// only when it is actually going to push. `--dry-run` discovers locally and must
// stay usable with no org configured.
//
// The guard fires only when no org is named AND the server holds several: a
// server that holds one organization fills it (client/single-org.ts). The
// test injects a config with no org by overriding `load()`, and the server's
// answer through a stand-in client the real guard asks; everything else stays real. The
// guard runs before the push, so every case is deterministic and offline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import type { Config } from "../../config/index.js";
import { classify, ExitCode } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

// When set, `load()` returns this config instead of reading disk/defaults.
// Reset in beforeEach so each test opts in explicitly.
let configOverride: Config | undefined;

// The server's answer to "do you hold one organization?".
let singleOrg = false;

vi.mock("../../client/single-org.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/single-org.js")>();
  // A fresh stand-in client per call, whose server answers `singleOrg`; the
  // real guard runs over it.
  const answering = () =>
    ({
      platform: { getServerInfo: async () => ({ singleOrg }) },
    }) as unknown as Stigmer;
  return {
    ...actual,
    holdsOneOrganization: () => actual.holdsOneOrganization(answering()),
    omitsOrganization: () => actual.omitsOrganization(answering()),
    requireOrganization: (_stigmer: Stigmer, org: string, setItWith: readonly string[]) =>
      actual.requireOrganization(answering(), org, setItWith),
  };
});

// A connect that settles, so the success rendering runs: the server's name and
// its organization as the backend returned them.
vi.mock("../../resources/connect/connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/connect/connect.js")>();
  const server = { metadata: { name: "orders", org: "stigmer" }, spec: {} };
  return {
    ...actual,
    connectMcpServer: async () => ({ server, capabilities: undefined, updated: server }),
  };
});

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return {
    ...actual,
    load: (path?: string) => configOverride ?? actual.load(path),
  };
});

/** An authenticated cloud config with no org selected — the guard's target shape. */
function cloudConfigWithoutOrg(): Config {
  return {
    backend: { type: "cloud" },
    backends: { cloud: { type: "cloud", token: "test-token" } },
    current_backend: "cloud",
  };
}

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
  readonly stdout: string;
}

// Runs `connect mcp-server <ref> [flags]` in standalone mode with output
// suppressed, returning the thrown error's classified exit code and message (or
// a success sentinel). `--standalone` is a program-global flag, so it must
// precede the subcommand (commander's enablePositionalOptions).
async function runConnect(
  ref: string,
  ...flags: string[]
): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  const written: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync([
      "node",
      "stigmer",
      "--standalone",
      "connect",
      "mcp-server",
      ref,
      ...flags,
    ]);
    return { exitCode: ExitCode.Success, message: "", stdout: written.join("") };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
      stdout: written.join(""),
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

let savedOrg: string | undefined;
let savedApiKey: string | undefined;

beforeEach(() => {
  configOverride = undefined;
  singleOrg = false;
  savedOrg = process.env.STIGMER_ORG;
  savedApiKey = process.env.STIGMER_API_KEY;
  delete process.env.STIGMER_ORG;
  delete process.env.STIGMER_API_KEY;
});

afterEach(() => {
  if (savedOrg === undefined) delete process.env.STIGMER_ORG;
  else process.env.STIGMER_ORG = savedOrg;
  if (savedApiKey === undefined) delete process.env.STIGMER_API_KEY;
  else process.env.STIGMER_API_KEY = savedApiKey;
});

describe("connect mcp-server org guard", () => {
  it("fails fast with actionable guidance when cloud mode has no org (non-dry-run)", async () => {
    configOverride = cloudConfigWithoutOrg();
    const outcome = await runConnect("mcp_test");
    expect(outcome.message).toContain("organization not set");
    expect(outcome.exitCode).toBe(ExitCode.Usage);
  });

  it("does not fire on a server that holds one organization: the server fills it, and the result names no organization", async () => {
    configOverride = cloudConfigWithoutOrg();
    singleOrg = true;
    const outcome = await runConnect("mcp_test");
    expect(outcome.message).not.toContain("organization not set");
    expect(outcome.stdout).toContain("MCP Server: orders");
    expect(outcome.stdout).not.toContain("stigmer/orders");
  });

  it("names the server with its organization on a server that holds several", async () => {
    configOverride = cloudConfigWithoutOrg();
    process.env.STIGMER_ORG = "stigmer";
    const outcome = await runConnect("mcp_test");
    expect(outcome.stdout).toContain("MCP Server: stigmer/orders");
  });

  it("does not apply the org guard in dry-run mode (offline dry-run stays usable)", async () => {
    // Dry-run skips the push, so the guard must not fire even with no org. The
    // command proceeds past the guard and fails later for an unrelated reason
    // (no reachable backend) — never with the org guidance error.
    const outcome = await runConnect("mcp_test", "--dry-run");
    expect(outcome.message).not.toContain("organization not set");
  });
});
