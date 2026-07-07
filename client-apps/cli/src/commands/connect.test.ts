// Command-level contract for the `connect mcp-server` org guard (issue #140).
//
// Connecting pushes to the backend, which requires an org. Rather than let the
// backend reject the request with the cryptic "org value length must be at least
// 1" validation error, the command fails fast with actionable guidance — but
// only when it is actually going to push. `--dry-run` discovers locally and must
// stay usable with no org configured.
//
// Runs in standalone mode so `load()` returns the default (local, org-less)
// config without reading the user's real config file. The guard runs before any
// network call, so the non-dry-run case is fully deterministic and offline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classify, ExitCode } from "../errors/index.js";
import { buildProgram } from "../program.js";

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
}

// Runs `connect mcp-server <ref> [flags]` in standalone mode with output
// suppressed, returning the thrown error's classified exit code and message (or
// a success sentinel). `--standalone` is a program-global flag, so it must
// precede the subcommand (commander's enablePositionalOptions).
async function runConnect(ref: string, ...flags: string[]): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  const outSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync(["node", "stigmer", "--standalone", "connect", "mcp-server", ref, ...flags]);
    return { exitCode: ExitCode.Success, message: "" };
  } catch (err) {
    return { exitCode: classify(err)?.exitCode ?? -1, message: err instanceof Error ? err.message : String(err) };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

let savedOrg: string | undefined;
let savedApiKey: string | undefined;

beforeEach(() => {
  savedOrg = process.env.STIGMER_ORG_ID;
  savedApiKey = process.env.STIGMER_API_KEY;
  delete process.env.STIGMER_ORG_ID;
  delete process.env.STIGMER_API_KEY;
});

afterEach(() => {
  if (savedOrg === undefined) delete process.env.STIGMER_ORG_ID;
  else process.env.STIGMER_ORG_ID = savedOrg;
  if (savedApiKey === undefined) delete process.env.STIGMER_API_KEY;
  else process.env.STIGMER_API_KEY = savedApiKey;
});

describe("connect mcp-server org guard", () => {
  it("fails fast with actionable guidance when no org is set (non-dry-run)", async () => {
    const outcome = await runConnect("mcp_test");
    expect(outcome.message).toContain("organization not set");
    expect(outcome.exitCode).toBe(ExitCode.Usage);
  });

  it("does not apply the org guard in dry-run mode (offline dry-run stays usable)", async () => {
    // Dry-run skips the push, so the guard must not fire even with no org. The
    // command proceeds past the guard and fails later for an unrelated reason
    // (no reachable backend) — never with the org guidance error.
    const outcome = await runConnect("mcp_test", "--dry-run");
    expect(outcome.message).not.toContain("organization not set");
  });
});
