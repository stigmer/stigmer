/**
 * The engine setup's inputs for a turn without a tree (`../turn-setup.ts`):
 * the gate's capture inputs are inert (nothing capturable, nothing in git,
 * nothing observed), and a skill's file is told by its path's text alone,
 * since nothing resolves to a real path.
 */
import { describe, expect, it } from "vitest";

import { captureInputsOf, NO_TREE_CAPTURE, skillReadCheckOf } from "../turn-setup.js";

describe("the engine setup without a tree", () => {
  it("gives the gate inert capture inputs", async () => {
    const inputs = captureInputsOf(undefined);
    expect(inputs).toBe(NO_TREE_CAPTURE);
    expect(await inputs.isCapturablePath!("/notes.md")).toBe(false);
    expect(await inputs.inGitDirectory!("/.git/config")).toBe(false);
    await expect(Promise.resolve(inputs.recordBlockedSecret!("/.env"))).resolves.toBeUndefined();
    await expect(Promise.resolve(inputs.captureDeleteBefore!("/notes.md"))).resolves.toBeUndefined();
  });

  it("tells a skill's file by its text alone", async () => {
    const reads = skillReadCheckOf(undefined, undefined);
    expect(await reads("/.stigmer/skills/notes/SKILL.md")).toBe(true);
    expect(await reads("/notes.md")).toBe(false);
  });
});
