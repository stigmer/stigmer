// Unit arms for the runner-log marker counts, over hand-written log text and
// a run directory of several runner logs.
// Domain: conformance benchmark.
//
// Pinned: each marker counts by its opening token at the start of a line,
// split by its field (an edit repair by tier, a cut by whether it was kept
// and by tool, a retry by phase and decision, the instruction reads by root
// and nested), and a hook's failure by its line; a cut from code before the
// `kept=` field counts as `kept_absent`; a near miss of each (the token
// mid-line, a missing or unknown field, a cut's follow-up line, another
// `[hooks]` line, a timing line) counts nothing; every `runner*.log` of a
// run's directory is read, the first runner's before each replacement's in
// the order they started, and no other file; the one-line rendering names
// every count and the files read.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countMarkers, emptyMarkers, readRunnerLogMarkers, renderRunnerLog } from "../log-markers";

const MARKERS = [
  "[EDIT-REPAIRED] tier=typography",
  "[EDIT-REPAIRED] tier=typography",
  "[EDIT-REPAIRED] tier=line-endings",
  "[TRUNCATED] tool=read_file original_chars=49434 limit=30000 chars_truncated=19434 kept=yes",
  "[TRUNCATED] tool=execute original_chars=61000 limit=30000 chars_truncated=31000 kept=no",
  "[TRUNCATED] tool=read_file original_chars=49434 limit=30000 chars_truncated=19434",
  "[MODEL-RETRY] phase=request decision=retry reason=overloaded status=529 retry_after_ms=none",
  "[MODEL-RETRY] phase=request decision=stop reason=invalid_request status=400 retry_after_ms=none",
  "[MODEL-RETRY] phase=stream decision=retry reason=connection attempt=1/3 delay_ms=1000",
  "[MODEL-RETRY] phase=stream decision=stop reason=connection attempt=3/3 delay_ms=none",
  "[REPO-INSTRUCTIONS] root=1 chars=171 cut=0",
  "[REPO-INSTRUCTIONS] root=1 chars=171 cut=0",
  "[REPO-INSTRUCTIONS] nested=2",
  "[hooks] a PostToolUse hook failed: format.mjs exited 1",
];

const NEAR_MISSES = [
  "[EDIT-REPAIRED]tier=typography",
  "[EDIT-REPAIRED] tier=",
  "note: [EDIT-REPAIRED] tier=typography",
  "[TRUNCATED] tool=execute could not keep the whole result: disk full",
  "[TRUNCATED] tool=read_file original_chars=49434 limit=30000 chars_truncated=19434 kept=maybe",
  "[MODEL-RETRY] phase=connect decision=retry reason=x",
  "[MODEL-RETRY] phase=request decision=wait reason=x",
  "[REPO-INSTRUCTIONS] chars=171 cut=0",
  "[hooks] Hook timeout of 3630s is very long (>1 hour)",
  '{"stigmer_timing":"turn_phases","execution_id":"aex_1","total_ms":10,"segments":[]}',
  "[runner] mode=static, proxy=none",
];

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("countMarkers", () => {
  it("counts every marker by its field, and a cut from code before `kept=` as kept_absent", () => {
    const counts = countMarkers(["", ...MARKERS, "   [EDIT-REPAIRED] tier=trailing-whitespace\r"].join("\n"));
    expect(counts).toEqual({
      files: [],
      edit_repaired: { typography: 2, "line-endings": 1, "trailing-whitespace": 1 },
      truncated: { kept_yes: 1, kept_no: 1, kept_absent: 1, by_tool: { read_file: 2, execute: 1 } },
      model_retry: { request: { retry: 1, stop: 1 }, stream: { retry: 1, stop: 1 } },
      repo_instructions: { root: 2, nested: 1 },
      hook_failures: 1,
    });
  });

  it("counts nothing for a near miss of any marker", () => {
    expect(countMarkers(NEAR_MISSES.join("\n"))).toEqual(emptyMarkers());
  });

  it("adds to the counts it is given", () => {
    const counts = countMarkers("[REPO-INSTRUCTIONS] root=1 chars=1 cut=0");
    expect(countMarkers("[REPO-INSTRUCTIONS] root=1 chars=1 cut=0", counts).repo_instructions.root).toBe(2);
  });
});

describe("readRunnerLogMarkers", () => {
  it("reads every runner log of the run, the first runner's first, and no other file", async () => {
    dir = await mkdtemp(join(tmpdir(), "log-markers-"));
    await writeFile(join(dir, "runner-10.log"), "[hooks] a PostToolUse hook failed: x\n");
    await writeFile(join(dir, "runner-2.log"), "[EDIT-REPAIRED] tier=typography\n");
    await writeFile(join(dir, "runner.log"), `${MARKERS.join("\n")}\n`);
    await writeFile(join(dir, "server.log"), "[EDIT-REPAIRED] tier=typography\n");
    await writeFile(join(dir, "runner.log.bak"), "[EDIT-REPAIRED] tier=typography\n");
    const markers = await readRunnerLogMarkers(dir);
    expect(markers.files).toEqual(["runner.log", "runner-2.log", "runner-10.log"]);
    expect(markers.edit_repaired).toEqual({ typography: 3, "line-endings": 1 });
    expect(markers.hook_failures).toBe(2);
  });

  it("reads zero from a run that wrote no runner log", async () => {
    dir = await mkdtemp(join(tmpdir(), "log-markers-"));
    expect(await readRunnerLogMarkers(dir)).toEqual(emptyMarkers());
  });
});

describe("renderRunnerLog", () => {
  it("names every count and the files read, on one line", () => {
    const markers = countMarkers(MARKERS.join("\n"));
    markers.files.push("runner.log", "runner-2.log");
    expect(renderRunnerLog(markers)).toBe(
      "edits repaired 3 (line-endings 1, typography 2); results cut 3 (kept 1, not kept 1, unsaid 1) (execute 1, read_file 2); " +
        "model calls retried 2, stopped 2; repository instructions read on 2 turns, 1 nested; hook failures 1; from runner.log, runner-2.log",
    );
    expect(renderRunnerLog(emptyMarkers())).toBe(
      "edits repaired 0; results cut 0 (kept 0, not kept 0, unsaid 0); model calls retried 0, stopped 0; " +
        "repository instructions read on 0 turns, 0 nested; hook failures 0; from no log",
    );
  });
});
