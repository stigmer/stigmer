/**
 * The harness boot order, proven in a fresh process.
 *
 * The contract (`harness/types.ts` `boot`, `http2-interceptor.ts` header):
 * the composition roots import `harness-adapters.js` and `harness/registry.js`
 * BEFORE bootstrap, the Cursor adapter's `boot` installs the proxy
 * interceptors — the HTTP/2 one patches `node:http2`, whose ESM facade is
 * snapshotted at its first import by `@connectrpc/connect-node` — proves the
 * patch reached the facade, and only then loads `@cursor/sdk`. Every module
 * on the pre-boot path must therefore be connect-free, and the adapter's
 * static graph SDK-free.
 *
 * Nothing in-process can test the positive arm: a vitest worker has imported
 * `node:http2` long before any test runs, so the facade is frozen to the
 * unpatched `connect` no matter what a test installs
 * (`http2-interceptor.test.ts` covers only the two deterministic negatives
 * for that reason). So each arm here spawns ONE fresh Node process
 * (`__test-utils__/harness-boot-order-child.ts`) that does exactly what the
 * roots do, and reads its one-line verdict. A static SDK import anywhere on
 * `adapter.ts`'s graph, or a static client import on the registry's, fails
 * the first arm; a `boot` that stopped asserting fails the second.
 *
 * `HOME` points at a temp dir so an SDK import-time side effect cannot touch
 * the developer's home; the proxy endpoint is an inert loopback; nothing is
 * dialled. Two spawns, a few seconds: the SDK is imported for real once.
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

interface ChildVerdict {
  readonly exitCode: number;
  readonly line: string;
}

async function runChild(arm: "boot" | "boot-after-connect-node"): Promise<ChildVerdict> {
  const home = mkdtempSync(join(tmpdir(), "stigmer-boot-order-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", CHILD, arm], {
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
  it("booting the harnesses on a proxy-mode config, the way the roots do, installs the interceptors, patches the facade, and loads the SDK", async () => {
    const verdict = await runChild("boot");
    expect(verdict.line, "the child's verdict").toBe("harness-boot-order: ok");
    expect(verdict.exitCode).toBe(0);
  });

  it("the same boot after connect-node was imported first fails loudly on the facade (the guard is live inside boot)", async () => {
    const verdict = await runChild("boot-after-connect-node");
    expect(verdict.exitCode).toBe(1);
    expect(verdict.line).toMatch(/node:http2 ESM facade is unpatched/);
  });
});
