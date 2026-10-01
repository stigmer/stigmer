// Pins how the CLI install runs one command (test/install/lib/install-cli.mjs):
// `spawnCommand` resolves at the command's exit with its output and never
// rejects; its `kill()` ends the whole process group and says so in `error`;
// a timeout says that instead, and a kill after the exit changes nothing.
// `whileRunning` kills and awaits its child before a failing body's error
// goes on, and leaves the child alone when the body succeeds. The commands
// are real `node` processes. Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { spawnCommand, whileRunning } from "./install-cli.mjs";

const node = [process.execPath];
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("a command that exits resolves with its status and output, and a later kill changes nothing", async () => {
  const child = spawnCommand(node, ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"], process.env, 10_000);
  const result = await child.done;
  assert.deepEqual(result, { status: 3, stdout: "out", stderr: "err", error: undefined });
  child.kill();
  assert.deepEqual(await child.done, result);
});

test("kill() ends the command's whole group, and done says the caller killed it", async () => {
  // The command starts a grandchild, as tsx starts the CLI in a child node process.
  const dir = mkdtempSync(join(tmpdir(), "spawn-command-"));
  const pidFile = join(dir, "grandchild.pid");
  const script =
    `const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });` +
    `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));` +
    `setInterval(() => {}, 1000);`;
  const child = spawnCommand(node, ["-e", script], process.env, 60_000);
  try {
    const grandchild = await until("the grandchild's pid", () => (existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : undefined));
    assert.equal(alive(grandchild), true);
    child.kill();
    const result = await child.done;
    assert.equal(result.error?.message, "killed by the caller");
    await until("the grandchild to go with its group", () => (alive(grandchild) ? undefined : true));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a command past its timeout is ended, and done says it timed out", async () => {
  const result = await spawnCommand(node, ["-e", "setInterval(() => {}, 1000)"], process.env, 200).done;
  assert.equal(result.error?.message, "timed out after 200ms");
});

test("whileRunning kills and awaits the child before a failing body's error goes on", async () => {
  const child = spawnCommand(node, ["-e", "setInterval(() => {}, 1000)"], process.env, 60_000);
  await assert.rejects(
    whileRunning(child, async () => {
      throw new Error("the step failed");
    }),
    /the step failed/,
  );
  const result = await child.done;
  assert.equal(result.error?.message, "killed by the caller");
});

test("whileRunning returns the body's value and leaves the child running", async () => {
  const child = spawnCommand(node, ["-e", "setTimeout(() => process.exit(0), 300)"], process.env, 60_000);
  assert.equal(await whileRunning(child, async () => "decided"), "decided");
  const result = await child.done;
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
});

/** Polls `read` every 25 ms until it answers, for up to 5 s. */
async function until(what, read) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
