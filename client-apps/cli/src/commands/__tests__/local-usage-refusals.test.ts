// Pins the usage refusals of two local commands, which take their exit code
// from the shared table (@stigmer/client/exit-codes): `stigmer logs` with an
// unknown component and `stigmer setup` with an unknown provider exit 2
// (Usage) and name the valid choices, before streaming or saving anything.
// HOME is a fresh temporary folder, so no real config or log is read.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCode } from "@stigmer/client/exit-codes";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { registerLogs } from "../logs.js";
import { registerSetup } from "../setup.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stigmer-local-usage-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("STIGMER_HOME", join(home, ".stigmer"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

async function run(register: (program: Command) => void, args: string[]): Promise<unknown> {
  const program = new Command().exitOverride();
  register(program);
  return program.parseAsync(["node", "stigmer", ...args]).then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("local commands refuse an unknown choice as a usage error", () => {
  it("logs --component names the components", async () => {
    const error = await run(registerLogs, ["logs", "--component", "nope", "--no-follow"]);
    expect(error).toBeInstanceOf(CliExitError);
    expect(error).toMatchObject({ exitCode: ExitCode.Usage, message: "unknown component: nope" });
  });

  it("setup --provider names the providers", async () => {
    const error = await run(registerSetup, ["setup", "--provider", "nope"]);
    expect(error).toBeInstanceOf(CliExitError);
    expect(error).toMatchObject({ exitCode: ExitCode.Usage, message: "unknown provider: nope" });
  });
});
