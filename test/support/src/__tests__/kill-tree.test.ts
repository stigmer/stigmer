// Unit arms for the harness's lost-machine kill (child-process.ts,
// descendantPids and killTree): a SIGKILL that stands for a lost machine must
// end every process a child started, not only the child, as a lost pod's
// processes all end (stigmer#2615; the runner's agent host and the engine
// once outlived the runner's SIGKILL and kept writing).
// Real processes: a shell that starts sleeps of its own and keeps running.
// Domain: test support (stack spawns).
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { descendantPids, killTree } from "../child-process.ts";

/** Whether a process is still there (signal 0 checks without sending). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Resolves once `ready()` holds, bounded. */
async function until(what: string, ready: () => boolean, budgetMs = 5_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${budgetMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const started: number[] = [];

afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone.
    }
  }
});

describe("descendantPids and killTree", () => {
  it("find every process a child started, and end them all, leaving the child to its caller", async () => {
    const child = spawn("sh", ["-c", "sleep 30 & sleep 30 & while :; do sleep 1; done"], { stdio: "ignore" });
    const pid = child.pid!;
    started.push(pid);
    await until("the shell started two sleeps", () => descendantPids(pid).length >= 2);
    const descendants = descendantPids(pid);
    started.push(...descendants);

    killTree(pid);
    await until("every descendant ended", () => descendants.every((descendant) => !alive(descendant)));
    expect(alive(pid), "the child itself is the caller's to stop").toBe(true);

    child.kill("SIGKILL");
    await once(child, "exit");
  });

  it("find nothing under a process with no children, and kill nothing there or under a pid that is gone", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const pid = child.pid!;
    started.push(pid);
    expect(descendantPids(pid)).toEqual([]);
    killTree(pid);
    expect(alive(pid), "killTree never signals the child itself").toBe(true);
    child.kill("SIGKILL");
    await once(child, "exit");
    expect(() => killTree(pid), "a pid that is gone").not.toThrow();
  });
});
