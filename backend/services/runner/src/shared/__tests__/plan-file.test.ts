/**
 * Pins the plan a Plan-mode turn returns (`../plan-file.ts`):
 *   - its name, from the plan's title with a content-hash discriminator, and
 *     the rule that recognizes a plan among Files;
 *   - its save into the session's outputs folder, staged beside the folder
 *     and renamed in, so the collector returns it; an empty plan saves
 *     nothing; and a runner killed between the write and the rename leaves
 *     nothing in the folder, so the next turn never returns half a plan.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { installAgentFs, localAgentFs } from "../agent-fs.js";
import { collectOutputs, OUTPUTS_SUBDIR, prepareOutputsFolder } from "../outputs.js";
import {
  isPlanFileName,
  PLAN_STAGING_FILE,
  planFileName,
  savePlanOutput,
} from "../plan-file.js";
import { getPlatformDir } from "../workspace/platform-dir.js";

/** Mirrors the runner's content-hash discriminator so tests can assert exact names. */
function planId(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 8);
}

describe("planFileName", () => {
  it("derives a hyphenated <slug>_<id>.plan.md name from the plan's leading # H1", () => {
    const text = "# Plan Card UX Cleanup\n\nBody";
    // "Plan Card…" has no label separator, so the genuine word "plan" survives.
    expect(planFileName(text)).toBe(`plan-card-ux-cleanup_${planId(text)}.plan.md`);
  });

  it("strips a leading 'Plan:' LABEL (colon/dash-anchored) from the slug", () => {
    const text = "# Plan: Fix the download UX\n\nbody";
    expect(planFileName(text)).toBe(`fix-the-download-ux_${planId(text)}.plan.md`);
  });

  it("collapses runs of punctuation/whitespace and trims edge hyphens", () => {
    const text = "#  Fix: the (download) UX!! \nx";
    expect(planFileName(text)).toBe(`fix-the-download-ux_${planId(text)}.plan.md`);
  });

  it("unwraps a ```markdown fenced plan before reading the title (SDK parity)", () => {
    const text = "```markdown\n# Named Plan\n\nbody\n```";
    expect(planFileName(text)).toBe(`named-plan_${planId(text)}.plan.md`);
  });

  it("unwraps a bare ``` fenced plan before reading the title (SDK parity)", () => {
    const text = "```\n# Bare Fenced Plan\n\nbody\n```";
    expect(planFileName(text)).toBe(`bare-fenced-plan_${planId(text)}.plan.md`);
  });

  it("caps the slug length so filenames stay bounded", () => {
    const longTitle = "# " + "word ".repeat(40); // ~200 chars of words
    const name = planFileName(longTitle);
    const match = /^(.+)_[0-9a-f]{8}\.plan\.md$/.exec(name);
    expect(match).not.toBeNull();
    const slug = match![1];
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to a bare <id>.plan.md when there is no leading H1", () => {
    const noTitle = "No title here\n\nbody";
    expect(planFileName(noTitle)).toBe(`${planId(noTitle)}.plan.md`);
    // An H1 further down is body content, not the title.
    const later = "intro\n\n# Later Heading";
    expect(planFileName(later)).toBe(`${planId(later)}.plan.md`);
  });

  it("falls back to a bare <id>.plan.md when the title is only the 'Plan:' label", () => {
    const text = "# Plan:\n\nbody";
    expect(planFileName(text)).toBe(`${planId(text)}.plan.md`);
  });

  it("falls back to a bare <id>.plan.md when the title has no alphanumerics", () => {
    const text = "# ---\n\nbody";
    expect(planFileName(text)).toBe(`${planId(text)}.plan.md`);
  });

  it("names every plan with the .plan.md suffix detection keys on", () => {
    for (const text of ["# A Title\n\nbody", "no heading", "# Plan:\n\nx"]) {
      expect(isPlanFileName(planFileName(text))).toBe(true);
    }
  });
});

describe("isPlanFileName", () => {
  it("accepts any *.plan.md", () => {
    expect(isPlanFileName("feature_x.plan.md")).toBe(true);
    expect(isPlanFileName("fix-the-download-ux_a1b2c3d4.plan.md")).toBe(true);
    expect(isPlanFileName("a1b2c3d4.plan.md")).toBe(true);
  });

  it("rejects non-plan filenames", () => {
    expect(isPlanFileName("notes.md")).toBe(false);
    expect(isPlanFileName("plan.md")).toBe(false);
    expect(isPlanFileName("plan.md.bak")).toBe(false);
    expect(isPlanFileName("myplan.md")).toBe(false);
  });
});

describe("savePlanOutput", () => {
  const SESSION = "ses_plan";
  let root: string;
  let originalHome: string | undefined;

  const outputsDir = (): string => join(getPlatformDir(SESSION), OUTPUTS_SUBDIR);

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "plan-output-"));
    originalHome = process.env.HOME;
    process.env.HOME = join(root, "home");
    const workspace = join(root, "ws");
    await localAgentFs.mkdir(workspace, { recursive: true });
    await prepareOutputsFolder(SESSION, workspace);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("saves the plan into the outputs folder under its name, leaving nothing staged", async () => {
    const plan = "# Migrate billing\n\n1. Move the ledger.\n";
    const name = await savePlanOutput({ sessionId: SESSION, planText: plan });
    expect(name).toBe(`migrate-billing_${planId(plan)}.plan.md`);
    expect(readdirSync(outputsDir())).toEqual([name]);
    expect(readFileSync(join(outputsDir(), name!), "utf8")).toBe(plan);
    expect(existsSync(join(getPlatformDir(SESSION), PLAN_STAGING_FILE)), "the staged write was renamed in").toBe(false);
  });

  it("saves nothing for an empty plan", async () => {
    expect(await savePlanOutput({ sessionId: SESSION, planText: "   \n" })).toBeUndefined();
    expect(readdirSync(outputsDir())).toEqual([]);
  });

  it("leaves nothing in the outputs folder when the runner stops between the write and the rename", async () => {
    const plan = "# Half a plan\n\n1. Start.\n";
    const restore = installAgentFs({
      ...localAgentFs,
      rename: () => Promise.reject(new Error("the runner was killed")),
    });
    try {
      await expect(savePlanOutput({ sessionId: SESSION, planText: plan })).rejects.toThrow(/killed/);
    } finally {
      restore();
    }
    expect(readdirSync(outputsDir()), "nothing the collector would return").toEqual([]);

    const client = mockStigmerClient({
      acquireScopedRunnerToken: vi.fn().mockResolvedValue("scoped"),
      createOutputUploads: vi.fn(),
      registerOutputs: vi.fn(),
    });
    const collected = await collectOutputs({ client, executionId: "run_next", sessionId: SESSION });
    expect(collected.returned.size, "the next turn returns no half plan").toBe(0);
    expect(client.createOutputUploads).not.toHaveBeenCalled();
  });
});
