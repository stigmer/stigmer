/**
 * Plan detection over the conversation's Files: a Plan-mode turn's plan is the
 * File it returned under the plan filename convention. Pins that only a File
 * the turn returned counts (a person's upload of the same name does not), that
 * only a Plan-mode run has a plan, that the newest match wins, and that the
 * session's latest plan walks the runs newest first.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { FileSchema, type File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  isPlanFileName,
  isPlanFile,
  findPlanFile,
  findLatestSessionPlan,
  planFilesByRun,
  PLAN_FILE_NAME,
} from "../detect-plan-file";

function file(id: string, filename: string, runId = ""): StigmerFile {
  return create(FileSchema, {
    metadata: { id },
    spec: { filename },
    status: { runId, outputPath: runId ? filename : "" },
  });
}

function run(id: string, mode: InteractionMode = InteractionMode.PLAN) {
  return create(RunSchema, { metadata: { id }, spec: { interactionMode: mode } });
}

describe("isPlanFileName", () => {
  it("accepts the legacy exact name and any *.plan.md", () => {
    expect(isPlanFileName(PLAN_FILE_NAME)).toBe(true);
    expect(isPlanFileName("feature_x.plan.md")).toBe(true);
    // The runner's current shape: hyphenated slug + content-hash discriminator.
    expect(isPlanFileName("fix-the-download-ux_a1b2c3d4.plan.md")).toBe(true);
    expect(isPlanFileName("a1b2c3d4.plan.md")).toBe(true);
  });

  it("rejects non-plan filenames", () => {
    expect(isPlanFileName("report.md")).toBe(false);
    expect(isPlanFileName("plan.txt")).toBe(false);
    expect(isPlanFileName("myplan.md")).toBe(false);
  });
});

describe("isPlanFile", () => {
  it("is true for a File a run returned under a plan name", () => {
    expect(isPlanFile(file("f1", "plan-card-ux-cleanup_a1b2c3d4.plan.md", "r1"))).toBe(true);
  });

  it("is false for a person's upload of the same name", () => {
    expect(isPlanFile(file("f1", "plan-card-ux-cleanup_a1b2c3d4.plan.md"))).toBe(false);
  });

  it("is false for other filenames", () => {
    expect(isPlanFile(file("f1", "report.md", "r1"))).toBe(false);
  });
});

describe("findPlanFile", () => {
  it("returns undefined for a missing run or no Files", () => {
    expect(findPlanFile([], null)).toBeUndefined();
    expect(findPlanFile([], undefined)).toBeUndefined();
    expect(findPlanFile([], run("r1"))).toBeUndefined();
  });

  it("finds the run's plan among its other outputs and other runs' plans", () => {
    const files = [
      file("f3", "data.json", "r1"),
      file("f2", "other_11111111.plan.md", "r2"),
      file("f1", "mine_22222222.plan.md", "r1"),
    ];
    expect(findPlanFile(files, run("r1"))?.metadata?.id).toBe("f1");
  });

  it("returns the newest plan File when the run returned more than one", () => {
    // The list is newest first.
    const files = [file("new", "a_1.plan.md", "r1"), file("old", "a_0.plan.md", "r1")];
    expect(findPlanFile(files, run("r1"))?.metadata?.id).toBe("new");
  });

  it("finds no plan on a run that did not run in Plan mode", () => {
    const files = [file("f1", "a_1.plan.md", "r1")];
    expect(findPlanFile(files, run("r1", InteractionMode.AGENT))).toBeUndefined();
  });
});

describe("findLatestSessionPlan", () => {
  it("returns undefined when no run returned a plan", () => {
    const files = [file("f1", "report.md", "r1")];
    expect(findLatestSessionPlan(files, [run("r1"), run("r2")])).toBeUndefined();
    expect(findLatestSessionPlan([], [])).toBeUndefined();
  });

  it("returns the newest plan across runs, with its run id", () => {
    const files = [
      file("f3", "b_3.plan.md", "r3"),
      file("f2", "notes.txt", "r2"),
      file("f1", "a_1.plan.md", "r1"),
    ];
    const plan = findLatestSessionPlan(files, [run("r1"), run("r2"), run("r3")]);
    expect(plan?.runId).toBe("r3");
    expect(plan?.file.metadata?.id).toBe("f3");
  });

  it("skips a newer plan-less run and returns the older plan", () => {
    const files = [file("f2", "data.json", "r2"), file("f1", "a_1.plan.md", "r1")];
    expect(findLatestSessionPlan(files, [run("r1"), run("r2")])?.runId).toBe("r1");
  });
});

describe("planFilesByRun", () => {
  it("maps each Plan-mode run to its plan File", () => {
    const files = [file("f2", "b_2.plan.md", "r2"), file("f1", "a_1.plan.md", "r1")];
    const byRun = planFilesByRun(files, [run("r1"), run("r2", InteractionMode.AGENT)]);
    expect([...byRun.keys()]).toEqual(["r1"]);
    expect(byRun.get("r1")?.metadata?.id).toBe("f1");
  });
});
