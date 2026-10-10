/**
 * The turn runtime's own graph opens no file and starts no process on a
 * path the agent can write (#2016): its work on the workspace, the session's
 * platform directory and the agent's state goes through `shared/agent-fs.ts`,
 * which the runner routes to the agent host. A module that imports
 * `node:fs` or `node:child_process` directly would be a deputy with the
 * runner's rights; this fence refuses one outside the list below, each
 * named with why it touches only the runner's own files.
 *
 * The walk starts at `harness/run-turn.ts` and follows static and dynamic
 * imports, stopping at `activities/`: the adapters run in the host, as the
 * agent (`agent-host/`). Pinned also: hosting routes the operations to the
 * host while it runs, and back when it closes.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { hostHarnesses } from "../../agent-host/hosting.js";
import { loopbackChannels } from "../../agent-host/channel.js";
import { agentFs, localAgentFs } from "../../shared/agent-fs.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW_ACCESS = /^node:(fs|fs\/promises|child_process)$/;

/** The modules that may, and why each touches only the runner's own files. */
const RUNNERS_OWN: ReadonlyMap<string, string> = new Map([
  ["shared/agent-fs.ts", "the local implementation; in the runner, hosting installs the host's"],
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

function rawAccessInRuntime(): Map<string, string[]> {
  const seen = new Set<string>();
  const found = new Map<string, string[]>();
  const queue = ["harness/run-turn.ts"];
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
  it("opens files and starts processes only through the agent's operations, but for the runner's own state", () => {
    const found = rawAccessInRuntime();
    expect([...found.keys()].filter((module) => !RUNNERS_OWN.has(module)).sort()).toEqual([]);
    expect([...RUNNERS_OWN.keys()].filter((module) => !found.has(module)), "a listed module that no longer needs it leaves the list").toEqual([]);
  });

  it("routes the operations to the host while the runner hosts its harnesses, and back when it closes", async () => {
    const hosted = await hostHarnesses([], testConfig(), { start: async () => ({ channel: loopbackChannels()[0], kill: () => {} }) });
    expect(agentFs()).not.toBe(localAgentFs);
    await hosted.close();
    expect(agentFs()).toBe(localAgentFs);
  });
});
