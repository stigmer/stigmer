/**
 * The harness boot order, and the runner's freedom from the engines, proven
 * in fresh processes.
 *
 * Every harness runs in the agent host (#2016): the composition roots import
 * `harness-adapters.js`, `harness/registry.js` and `agent-host/hosting.js`,
 * host the table, and boot the remote adapters, which start a host from this
 * build's entry and boot the real adapters there. The Cursor adapter's
 * `boot` installs its proxy interceptors — the HTTP/2 one patches
 * `node:http2`, whose ESM facade is snapshotted at its first import by
 * `@connectrpc/connect-node` — proves the patch reached the facade, and only
 * then loads `@cursor/sdk`; that ordering now holds inside the host's own
 * fresh process, and a host whose graph imported connect-node first would
 * fail the first arm.
 *
 * The runner itself loads no engine. The child runs with
 * `__test-utils__/refuse-engine-sdks.ts`, a resolve hook that refuses
 * `@cursor/sdk` and `deepagents` in the runner's process (the host is
 * spawned without it), so a runner that booted an engine in-process, or
 * imported one anywhere on its boot path, fails the first arm; the second
 * arm imports the SDK on purpose to prove the refusal is live.
 *
 * `HOME` points at a temp dir so an SDK import-time side effect cannot touch
 * the developer's home; the proxy endpoint is an inert loopback; nothing is
 * dialled.
 */

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHILD = fileURLToPath(new URL("../__test-utils__/harness-boot-order-child.ts", import.meta.url));
const REFUSE_ENGINES = fileURLToPath(new URL("../__test-utils__/refuse-engine-sdks.ts", import.meta.url));

interface ChildVerdict {
  readonly exitCode: number;
  readonly line: string;
}

async function runChild(arm: "boot" | "import-engine"): Promise<ChildVerdict> {
  const home = mkdtempSync(join(tmpdir(), "stigmer-boot-order-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--import", REFUSE_ENGINES, CHILD, arm], {
      env: { ...process.env, HOME: home },
      timeout: 25_000,
    });
    return { exitCode: 0, line: lastLine(stdout) };
  } catch (err) {
    const failure = err as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.code ?? -1, line: lastLine(`${failure.stdout ?? ""}${failure.stderr ?? ""}`) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

describe("harness boot order (fresh process)", () => {
  it("boots both harnesses in a real agent host, the Cursor interceptors first there, while the runner loads neither engine", async () => {
    const verdict = await runChild("boot");
    expect(verdict.line, "the child's verdict").toBe("harness-boot-order: ok");
    expect(verdict.exitCode).toBe(0);
  });

  it("refuses an engine's SDK in the runner's process (the fence is live)", async () => {
    const verdict = await runChild("import-engine");
    expect(verdict.exitCode).toBe(1);
    expect(verdict.line).toBe("harness-boot-order: the runner process imported @cursor/sdk, an engine SDK that belongs to the agent host");
  });
});
