/*
 * Spike probe (the measurements the container makes): how slow is the
 * engine to start, how much memory does one hold, and where does it write?
 *
 *  - cold: `query()` to the `system/init` message, a fresh process and config each time;
 *  - resume: the same for a `resume` of a finished session (a turn's re-entry);
 *  - startup(): the process started ahead, then `query()` to init;
 *  - prewarm() then claim(): a parked spare claimed by a session;
 *  - one live engine's resident memory, sampled while a response is held;
 *  - on Linux, every file written outside the engine's config and working
 *    directories during a turn.
 *
 * Medians of SPIKE_STARTS runs (ten by default). Run in the container as
 * the agent user (`container/q6.sh`); on this Mac the numbers are indicative.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prewarm, startup, type Query } from "@anthropic-ai/claude-agent-sdk";
import {
  anthropicText,
  baseOptions,
  freshDirs,
  resultSummary,
  runQuery,
  startSpikeMock,
  trackedSpawn,
  writeEvidence,
  type SpikeMock,
} from "./harness.js";

const STARTS = Number(process.env.SPIKE_STARTS ?? "10");
const TIMEOUT = 900_000;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

async function untilInit(q: Query, started: number): Promise<{ initMs: number | undefined; wallMs: number }> {
  let initMs: number | undefined;
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init" && initMs === undefined) initMs = Date.now() - started;
  }
  return { initMs, wallMs: Date.now() - started };
}

describe("q6: start cost, memory and writes", () => {
  let mock: SpikeMock;

  it("measures every start shape", async () => {
    mock = await startSpikeMock("q6", (c) =>
      c.allUserTexts.some((t) => t.includes("Q6-HOLD")) ? { body: anthropicText("q6 held"), delayMs: 4_000 } : anthropicText("q6 ok"),
    );
    const out: Record<string, unknown> = { platform: platform(), starts: STARTS };
    try {
      const cold: number[] = [];
      const coldWall: number[] = [];
      for (let i = 0; i < STARTS; i += 1) {
        const dirs = freshDirs(`q6-cold-${i}`);
        const run = await runQuery(`q6-cold-${i}`, "Q6 hello", baseOptions(dirs, mock.url));
        if (run.initMs !== undefined) cold.push(run.initMs);
        coldWall.push(run.wallMs);
      }
      out.cold = { initMs: cold, medianInitMs: median(cold), medianWallMs: median(coldWall) };

      const base = freshDirs("q6-resume");
      const first = await runQuery("q6-resume-first", "Q6 hello", baseOptions(base, mock.url));
      const resume: number[] = [];
      for (let i = 0; i < STARTS; i += 1) {
        const run = await runQuery(`q6-resume-${i}`, "Q6 again", { ...baseOptions(base, mock.url), resume: first.sessionId });
        if (run.initMs !== undefined) resume.push(run.initMs);
      }
      out.resume = { initMs: resume, medianInitMs: median(resume) };

      const warmStart: number[] = [];
      const warmInit: number[] = [];
      for (let i = 0; i < STARTS; i += 1) {
        const dirs = freshDirs(`q6-startup-${i}`);
        const t0 = Date.now();
        const warm = await startup({ options: baseOptions(dirs, mock.url) });
        warmStart.push(Date.now() - t0);
        const t1 = Date.now();
        const r = await untilInit(warm.query("Q6 hello"), t1);
        if (r.initMs !== undefined) warmInit.push(r.initMs);
        warm.close();
      }
      out.startup = { startupMs: warmStart, medianStartupMs: median(warmStart), initAfterQueryMs: warmInit, medianInitAfterQueryMs: median(warmInit) };

      const spareStart: number[] = [];
      const spareInit: number[] = [];
      const spareErrors: string[] = [];
      for (let i = 0; i < STARTS; i += 1) {
        const dirs = freshDirs(`q6-prewarm-${i}`);
        try {
          const t0 = Date.now();
          const spare = await prewarm({ options: baseOptions(dirs, mock.url) });
          spareStart.push(Date.now() - t0);
          const t1 = Date.now();
          const r = await untilInit(spare.claim({ prompt: "Q6 hello", options: { cwd: dirs.cwd } }), t1);
          if (r.initMs !== undefined) spareInit.push(r.initMs);
        } catch (error) {
          spareErrors.push(error instanceof Error ? error.message : String(error));
        }
      }
      out.prewarm = { prewarmMs: spareStart, medianPrewarmMs: median(spareStart), initAfterClaimMs: spareInit, medianInitAfterClaimMs: median(spareInit), errors: spareErrors };

      // Resident memory of one live engine, sampled while its response is held.
      const dirs = freshDirs("q6-rss");
      const spawned = trackedSpawn("q6-rss");
      const samples: number[] = [];
      const sampler = setInterval(() => {
        const pid = spawned.processes[0]?.child.pid;
        if (pid === undefined) return;
        try {
          samples.push(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()));
        } catch {
          // The process may have exited between samples.
        }
      }, 250);
      const marker = join(dirs.root, "marker");
      writeFileSync(marker, "");
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const held = await runQuery("q6-rss", "Q6-HOLD hold on", { ...baseOptions(dirs, mock.url), spawnClaudeCodeProcess: spawned.spawnClaudeCodeProcess });
      clearInterval(sampler);
      out.rss = { result: resultSummary(held), kbSamples: samples, maxKb: Math.max(...samples) };

      if (platform() === "linux") {
        const written = execFileSync(
          "sh",
          ["-c", `find / -xdev -newer ${marker} -type f 2>/dev/null | grep -v -e '^/proc' -e '^/sys' -e '^${dirs.root}' | head -200`],
          { encoding: "utf8" },
        )
          .split("\n")
          .filter(Boolean);
        out.writesOutsideItsDirs = written;
      } else {
        out.writesOutsideItsDirs = "measured in the container only";
      }
      writeEvidence("q6.facts.json", out);
      expect(cold.length).toBeGreaterThan(0);
    } finally {
      await mock.close();
    }
  }, TIMEOUT);
});
