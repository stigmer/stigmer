/**
 * Pins the ready-line half of scripts/verify-boot.mjs, the boot gate CI runs
 * on every built artifact and the only check that runs main.ts: a boot whose
 * ready line matches its listening line passes, and one whose ready line names
 * another gRPC port, or an artifact port no listener binds, fails by name
 * rather than passing quietly. A stand-in entry (__fixtures__/verify-boot-entry.mjs)
 * plays the server, so each arm takes a fraction of a second; the real
 * artifact's pass is `npm run verify:dist`.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../../scripts/verify-boot.mjs", import.meta.url),
);
const ENTRY = fileURLToPath(
  new URL("./__fixtures__/verify-boot-entry.mjs", import.meta.url),
);

function verifyBoot(mode: string): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [SCRIPT, ENTRY], {
    env: { ...process.env, FAKE_MODE: mode },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe("verify-boot's ready line", () => {
  it("passes a boot whose ready line names the port its listening line names", () => {
    const run = verifyBoot("ok");
    expect(run.output).toContain("booted, served, announced its ports");
    expect(run.status).toBe(0);
  });

  it("fails a ready line naming another gRPC port than the listening line", () => {
    const run = verifyBoot("wrong-port");
    expect(run.output).toContain(
      "printed a ready line naming gRPC port 40008, but its listening line names 40001",
    );
    expect(run.status).toBe(1);
  });

  it("fails a ready line whose artifact port no listener binds", () => {
    const run = verifyBoot("malformed");
    expect(run.output).toContain(
      "printed a malformed ready line: artifactHttpPort is not a bound port",
    );
    expect(run.status).toBe(1);
  });
});
