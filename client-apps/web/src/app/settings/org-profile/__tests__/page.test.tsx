// ---------------------------------------------------------------------------
// The /settings/org-profile route — renders the Organization Profile section
// and lands on the dashboard when a child organization is opened from it
//
// The page hands the route to OrgProfileSection and gives it the landing an
// organization switch from the sidebar has. The section's behaviour (the
// profile, the Child organizations list and its Open action) is pinned by
// its own suites in @stigmer/react.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { OrgProfileSectionProps } from "@stigmer/react";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@stigmer/react", () => ({
  OrgProfileSection: ({ onOrgChanged }: OrgProfileSectionProps) => (
    <button type="button" onClick={() => onOrgChanged?.({} as never)}>
      open a child
    </button>
  ),
}));

import OrgProfilePage from "../page";

describe("/settings/org-profile route", () => {
  it("renders the Organization Profile section, whose opened child lands on the dashboard", () => {
    render(<OrgProfilePage />);
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "open a child" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/dashboard");
  });
});
