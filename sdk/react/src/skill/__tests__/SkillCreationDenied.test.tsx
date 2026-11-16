/**
 * A member who reaches the upload-skill page directly is told who uploads
 * skills, with nothing to press: only the organization's admins hold
 * `can_create_skill`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkillCreationDenied } from "../SkillCreationDenied";

afterEach(cleanup);

describe("SkillCreationDenied", () => {
  it("says only admins upload skills here, and offers nothing to press", () => {
    render(<SkillCreationDenied />);

    expect(screen.getByText("Only admins can upload skills here")).toBeTruthy();
    expect(screen.getByText("Ask an admin of this organization to add the know-how your agents need.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
