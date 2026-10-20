// The real-clock run's plan (../profile.ts): the two profiles' shapes, the
// bulk reads that cross three compactions, a step subset, each step's shell
// and what its markers say, run for real through `sh`.
// Domain: conformance long turn (pure, plus one real shell per step kind).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BULK_BYTES,
  ENDURANCE_EVERY_SECONDS,
  ENDURANCE_STEP_SECONDS,
  LONG_TURN_MODEL,
  NATIVE_SHELL_TIMEOUT_SECONDS,
  bulkReadsFor,
  enduranceProfile,
  goalProfile,
  narrateStep,
  parseLongTurnFlags,
  profileOf,
  shellCommandOf,
  timeoutSecondsOf,
  stepProgressOf,
  type StepFiles,
} from "../profile";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stepFiles(): StepFiles & { readonly dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "long-turn-profile-test-"));
  dirs.push(dir);
  return { dir, markers: join(dir, "markers"), releaseOf: (id) => join(dir, `release-${id}`) };
}

describe("the profiles", () => {
  it("goal plays the definition of done in order, on the model whose window compaction is measured against", () => {
    const goal = goalProfile();
    expect(goal.model).toBe(LONG_TURN_MODEL);
    expect(goal.steps.map((s) => s.kind).filter((k, i, all) => all.indexOf(k) === i)).toEqual(["silent", "streamed", "subagent", "bulk", "kill", "drain"]);
    expect(goal.steps.find((s) => s.kind === "silent")).toMatchObject({ seconds: 600 });
    expect(goal.steps.filter((s) => s.kind === "bulk")).toHaveLength(bulkReadsFor(3));
  });

  it("three compactions need the trigger crossed once and the kept remainder topped up twice", () => {
    expect(bulkReadsFor(1) * BULK_BYTES / 4).toBeGreaterThan(170_000);
    expect(bulkReadsFor(3)).toBeGreaterThan(bulkReadsFor(1) * 2);
  });

  it("endurance fills its minutes with commands that print every 20 s, end inside the shell's own timeout, and carry three compactions' bytes", () => {
    const endurance = enduranceProfile(180);
    expect(endurance.steps.length).toBeGreaterThan(80);
    for (const step of endurance.steps) expect(step).toMatchObject({ kind: "streamed", seconds: ENDURANCE_STEP_SECONDS, everySeconds: ENDURANCE_EVERY_SECONDS });
    // The shell's own sleeps (lines × every) end well inside its 120 s limit.
    const lines = Math.round(ENDURANCE_STEP_SECONDS / ENDURANCE_EVERY_SECONDS);
    expect(lines * ENDURANCE_EVERY_SECONDS).toBeLessThanOrEqual(NATIVE_SHELL_TIMEOUT_SECONDS - 15);
    const bytes = endurance.steps.reduce((sum, s) => sum + (s.kind === "streamed" ? s.bytesPerLine * (s.seconds / s.everySeconds) : 0), 0);
    expect(bytes).toBeGreaterThan(bulkReadsFor(3) * BULK_BYTES);
    expect(endurance.budgetMs).toBe(210 * 60_000);
    expect(enduranceProfile(1).steps).toHaveLength(1);
  });

  it("names a profile by flag, keeps a subset of its steps in order, and refuses what it does not know", () => {
    expect(profileOf("goal", { steps: ["drained-mid-tool", "silent-build"] }).steps.map((s) => s.id)).toEqual(["silent-build", "drained-mid-tool"]);
    expect(profileOf("endurance", { minutes: 30 }).steps.length).toBe(enduranceProfile(30).steps.length);
    expect(profileOf("goal", { steps: [] }).steps).toEqual(goalProfile().steps);
    expect(() => profileOf("forever")).toThrow(/unknown profile 'forever'/);
    expect(() => profileOf("goal", { steps: ["nope"] })).toThrow(/has no step nope/);
  });
});

describe("the step shells", () => {
  function run(command: string): string {
    return execFileSync("sh", ["-c", command], { encoding: "utf8" });
  }

  it("a silent, a streamed and a bulk step mark their start and end, and print what they promise", () => {
    const files = stepFiles();
    expect(run(shellCommandOf({ kind: "silent", id: "s", seconds: 0 }, files))).toBe("");
    const streamed = run(shellCommandOf({ kind: "streamed", id: "t", seconds: 2, everySeconds: 1, bytesPerLine: 40 }, files));
    expect(streamed.split("\n").filter((l) => l.startsWith("line ")).map((l) => l.length)).toEqual([27, 27]);
    expect(run(shellCommandOf({ kind: "streamed", id: "u", seconds: 1, everySeconds: 1, bytesPerLine: 10 }, files))).toBe("line 1\n");
    expect(run(shellCommandOf({ kind: "bulk", id: "b", bytes: 1_000 }, files)).trim()).toHaveLength(1_000);
    expect(stepProgressOf(readFileSync(files.markers, "utf8"))).toEqual({ started: ["s", "t", "u", "b"], ended: ["s", "t", "u", "b"], open: undefined });
  });

  it("a held step waits for its release file; until then it is the open step", async () => {
    const files = stepFiles();
    const held = shellCommandOf({ kind: "drain", id: "d" }, files);
    const child = (await import("node:child_process")).spawn("sh", ["-c", held]);
    const exited = new Promise((resolve) => child.on("exit", resolve));
    const deadline = Date.now() + 5_000;
    while (!readMarkers(files).includes("start d") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(stepProgressOf(readMarkers(files)).open).toBe("d");
    writeFileSync(files.releaseOf("d"), "released\n");
    expect(await exited).toBe(0);
    expect(stepProgressOf(readMarkers(files))).toMatchObject({ ended: ["d"], open: undefined });
    expect(shellCommandOf({ kind: "kill", id: "k" }, files)).toContain(files.releaseOf("k"));
  });

  it("a subagent's work is a silent shell its subagent runs, and the live narration hands that shell over", () => {
    const files = stepFiles();
    expect(run(shellCommandOf({ kind: "subagent", id: "a", seconds: 0 }, files))).toBe("");
    expect(stepProgressOf(readMarkers(files))).toMatchObject({ started: ["a"], ended: ["a"] });
    const narrated = narrateStep({ kind: "subagent", id: "a", seconds: 240 }, files);
    expect(narrated).toMatch(/^Hand this to a general-purpose subagent with the task tool/);
    expect(narrated).toContain("with a timeout of 360 seconds");
    expect(narrated).toContain("sleep 240");
    expect(narrated.match(/"/g), "the quoted task holds no inner double quote").toHaveLength(2);
  });

  it("names a timeout past each long step's length, a long one for a held step, and none for a bulk read", () => {
    expect(timeoutSecondsOf({ kind: "silent", id: "s", seconds: 600 })).toBe(720);
    expect(timeoutSecondsOf({ kind: "streamed", id: "t", seconds: 600, everySeconds: 30, bytesPerLine: 80 })).toBe(720);
    expect(timeoutSecondsOf({ kind: "kill", id: "k" })).toBe(3_000);
    expect(timeoutSecondsOf({ kind: "drain", id: "d" })).toBe(3_000);
    expect(timeoutSecondsOf({ kind: "bulk", id: "b", bytes: 1 })).toBeUndefined();
    const files = stepFiles();
    expect(narrateStep({ kind: "silent", id: "s", seconds: 600 }, files)).toBe(
      `Run exactly this shell command, with a timeout of 720 seconds, and wait for it to finish: ${shellCommandOf({ kind: "silent", id: "s", seconds: 600 }, files)}`,
    );
    expect(narrateStep({ kind: "bulk", id: "b", bytes: 1 }, files)).toMatch(/^Run exactly this shell command and wait for it to finish: /);
  });

  it("reads the open step as the latest one begun more often than it ended, ignoring other lines", () => {
    expect(stepProgressOf("start a\nend a\nstart b\nnoise\nstart c\nend c\n")).toEqual({ started: ["a", "b", "c"], ended: ["a", "c"], open: "b" });
    expect(stepProgressOf("")).toEqual({ started: [], ended: [], open: undefined });
  });
});

function readMarkers(files: StepFiles): string {
  try {
    return readFileSync(files.markers, "utf8");
  } catch {
    return "";
  }
}

describe("the flags", () => {
  it("reads the profile, its minutes, a step subset, the report directory and the harness, with defaults", () => {
    expect(parseLongTurnFlags(["--profile", "endurance", "--minutes", "30", "--steps", "a,b", "--out", "/tmp/x", "--harness", "cursor"])).toEqual({
      profile: "endurance",
      minutes: 30,
      steps: ["a", "b"],
      out: "/tmp/x",
      harness: "cursor",
    });
    expect(parseLongTurnFlags([])).toEqual({ profile: "goal", minutes: undefined, steps: [], out: undefined, harness: "deep-agent" });
    expect(() => parseLongTurnFlags(["--minutes", "soon"])).toThrow(/--minutes must be a positive number/);
  });
});
