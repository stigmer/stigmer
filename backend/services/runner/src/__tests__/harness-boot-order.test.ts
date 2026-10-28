/**
 * The runner's freedom from the engines, proven in fresh processes.
 *
 * Every harness runs in the agent host (#2016): the composition roots import
 * `harness-adapters.js`, `harness/registry.js` and `agent-host/hosting.js`,
 * host the table, and boot the remote adapters, which start a host from this
 * build's entry and boot the real adapters there.
 *
 * The runner itself loads no engine. The child runs with
 * `__test-utils__/refuse-engine-sdks.ts`, a resolve hook that refuses
 * `deepagents` and `@anthropic-ai/claude-agent-sdk` in the runner's process
 * (the host is spawned without it), so a runner that booted an engine
 * in-process, or imported one anywhere on its boot path, fails the first
 * arm; the refusal arms import an SDK on purpose to prove the refusal is
 * live, native's and Claude's.
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

async function runChild(arm: "boot" | "import-engine" | "import-claude"): Promise<ChildVerdict> {
  const home = mkdtempSync(join(tmpdir(), "stigmer-boot-order-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--import", REFUSE_ENGINES, CHILD, arm], {
      env: { ...process.env, HOME: home },
      timeout: 25_000,
    });
    return { exitCode: 0, line: verdictLine(stdout, "") };
  } catch (err) {
    const failure = err as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.code ?? -1, line: verdictLine(failure.stdout ?? "", failure.stderr ?? "") };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** The child's own verdict line; else the last line it wrote (a crash before it could print one). The host's relayed output can follow it. */
function verdictLine(stdout: string, stderr: string): string {
  const verdict = stdout.split("\n").filter((line) => line.startsWith("harness-boot-order:")).at(-1);
  if (verdict !== undefined) return verdict;
  const lines = `${stdout}${stderr}`.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

describe("harness boot order (fresh process)", () => {
  it("boots every harness in a real agent host while the runner loads no engine", async () => {
    const verdict = await runChild("boot");
    expect(verdict.line, "the child's verdict").toBe("harness-boot-order: ok");
    expect(verdict.exitCode).toBe(0);
  });

  it("refuses the native engine's SDK in the runner's process (the fence is live)", async () => {
    const verdict = await runChild("import-engine");
    expect(verdict.exitCode).toBe(1);
    expect(verdict.line).toBe("harness-boot-order: the runner process imported deepagents, an engine SDK that belongs to the agent host");
  });

  it("refuses the Claude engine's SDK in the runner's process", async () => {
    const verdict = await runChild("import-claude");
    expect(verdict.exitCode).toBe(1);
    expect(verdict.line).toBe("harness-boot-order: the runner process imported @anthropic-ai/claude-agent-sdk, an engine SDK that belongs to the agent host");
  });
});
