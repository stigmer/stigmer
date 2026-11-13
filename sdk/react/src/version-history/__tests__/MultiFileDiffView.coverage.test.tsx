/**
 * MultiFileDiffView's two faces: identical versions show the "No
 * differences found" empty state in place of a diff, and a changed file
 * shows the summary and that file's diff instead.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { computeMultiFileDiff } from "../computeMultiFileDiff";
import { MultiFileDiffView } from "../MultiFileDiffView";

afterEach(cleanup);

describe("MultiFileDiffView", () => {
  it("says the versions are identical when no file changed", () => {
    const files = new Map([["SKILL.md", "# Skill\n"]]);
    render(<MultiFileDiffView diff={computeMultiFileDiff(files, new Map(files))} />);

    expect(screen.getByText("No differences found")).toBeTruthy();
    expect(screen.getByText("These two versions have identical content.")).toBeTruthy();
    expect(screen.queryByText("1 file changed")).toBeNull();
  });

  it("shows the summary instead of the empty state when a file changed", () => {
    const diff = computeMultiFileDiff(new Map([["SKILL.md", "old\n"]]), new Map([["SKILL.md", "new\n"]]));
    render(<MultiFileDiffView diff={diff} />);

    expect(screen.getByText("1 file changed")).toBeTruthy();
    expect(screen.queryByText("No differences found")).toBeNull();
  });
});
