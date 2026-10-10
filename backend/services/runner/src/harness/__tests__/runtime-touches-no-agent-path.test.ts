/**
 * The turn runtime's own graph opens no file and starts no process on a
 * path the agent can write (#2016): its work on the workspace, the session's
 * platform directory and the agent's state goes through `shared/agent-fs.ts`,
 * which the runner routes to the agent host. A module that imports
 * `node:fs` or `node:child_process` directly would be a deputy with the
 * runner's rights; this fence refuses one outside the list below, each
 * named with why it touches only the runner's own files.
 *
 * The walk starts at `harness/run-turn.ts` and at every activity the runner
 * itself runs (every activity module `runner.ts` and `runner-manager.ts`
 * import, statically or dynamically, other than as types: read from their
 * source, so a new one is walked without editing this test), and follows
 * static and dynamic imports, stopping at the rest of `activities/`: the adapters run
 * in the host, as the agent (`agent-host/`). Pinned also: hosting routes the
 * operations to the host while it runs, back when it closes, and on a
 * separating runner refuses them once it has closed.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { hostHarnesses } from "../../agent-host/hosting.js";
import { loopbackChannels } from "../../agent-host/channel.js";
import { agentFs, installAgentFs, localAgentFs } from "../../shared/agent-fs.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW_ACCESS = /^node:(fs|fs\/promises|child_process)$/;

/** The modules that may, and why each touches only the runner's own files. */
const RUNNERS_OWN: ReadonlyMap<string, string> = new Map([
  ["shared/agent-fs.ts", "the local implementation; in the runner, hosting installs the host's"],
  ["shared/agent-identity.ts", "the agent user's /etc/passwd lines, its home and the setpriv probe, at boot, before any agent runs"],
  ["shared/artifact-storage.ts", "the runner's own local artifact store, under its state directory"],
  ["shared/workspace/workspace-lock.ts", "the lock files, under the runner's own state directory"],
  ["config.ts", "creates the configured workspace root at start-up, before any agent runs"],
]);

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const match of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm)) specs.push(match[1]!);
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]!);
  return specs;
}

/** The activities the runner runs in its own process: those either composition root imports to build its activity table. */
function runnerSideActivities(): string[] {
  const found = new Set<string>();
  for (const root of ["runner.ts", "runner-manager.ts"]) {
    const text = readFileSync(join(SRC, root), "utf8");
    for (const match of text.matchAll(/(?:import\(\s*|^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?)["']\.\/(activities\/[^"']+)\.js["']/gm)) found.add(`${match[1]!}.ts`);
  }
  return [...found];
}

function rawAccessInRuntime(): Map<string, string[]> {
  const seen = new Set<string>();
  const found = new Map<string, string[]>();
  const queue = ["harness/run-turn.ts", ...runnerSideActivities()];
  while (queue.length > 0) {
    const rel = queue.pop()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const spec of importsOf(join(SRC, rel))) {
      if (spec.startsWith(".")) {
        const target = relative(SRC, resolve(SRC, dirname(rel), spec)).replace(/\.js$/, ".ts");
        if (!target.startsWith("activities/")) queue.push(target);
      } else if (RAW_ACCESS.test(spec)) {
        found.set(rel, [...(found.get(rel) ?? []), spec]);
      }
    }
  }
  return found;
}

describe("the turn runtime and the agent's paths", () => {
  it("walks every activity the runner runs itself", () => {
    expect(runnerSideActivities()).toEqual(expect.arrayContaining(["activities/attach-session.ts", "activities/discover-mcp-server.ts", "activities/ensure-thread.ts", "activities/generate-session-subject.ts"]));
  });

  it("opens files and starts processes only through the agent's operations, but for the runner's own state", () => {
    const found = rawAccessInRuntime();
    expect([...found.keys()].filter((module) => !RUNNERS_OWN.has(module)).sort()).toEqual([]);
    expect([...RUNNERS_OWN.keys()].filter((module) => !found.has(module)), "a listed module that no longer needs it leaves the list").toEqual([]);
  });

  it("routes the operations to the host while the runner hosts its harnesses, and back when it closes", async () => {
    const hosted = await hostHarnesses([], testConfig(), { identity: null, start: async () => ({ channel: loopbackChannels()[0], kill: () => {} }) });
    expect(agentFs()).not.toBe(localAgentFs);
    await hosted.close();
    expect(agentFs()).toBe(localAgentFs);
  });

  it("refuses them after the host closes on a runner that separates, never performing them itself", async () => {
    const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "/home/stigmer-agent" };
    const hosted = await hostHarnesses([], testConfig(), { identity, prepareSeparation: () => null, start: async () => ({ channel: loopbackChannels()[0], kill: () => {} }) });
    await hosted.close();
    try {
      await expect(agentFs().readFile("/etc/hostname")).rejects.toThrow("the agent host has closed; the runner performs no operation on the agent's paths itself");
      await expect(agentFs().execFile("true", [])).rejects.toThrow("the agent host has closed");
    } finally {
      installAgentFs(localAgentFs);
    }
  });
});
