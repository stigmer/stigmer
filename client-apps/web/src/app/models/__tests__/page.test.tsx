// ---------------------------------------------------------------------------
// The Models & providers route — renders the React SDK's models hub
//
// The page is the route's whole job: it hands /models to ModelsHub for the
// active organization, and draws nothing until one is active, so a route
// that drifted to another page, or a page that handed the hub another
// organization, would show here. The hub's behaviour is pinned by its own
// suite in sdk/react.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const page = vi.hoisted(() => ({ org: "org_acme" as string | null }));

vi.mock("@stigmer/react-sdk", () => ({
  useActiveOrgId: () => page.org,
  ModelsHub: ({ org }: { org: string }) => <p>{`models hub for ${org}`}</p>,
}));

import ModelsRoute from "../page";

beforeEach(() => {
  page.org = "org_acme";
});

describe("Models & providers route", () => {
  it("renders the models hub for the active organization", () => {
    render(<ModelsRoute />);
    expect(screen.getByText("models hub for org_acme")).toBeTruthy();
  });

  it("renders nothing until an organization is active", () => {
    page.org = null;
    const { container } = render(<ModelsRoute />);
    expect(screen.queryByText(/models hub/)).toBeNull();
    expect(container.childElementCount).toBe(0);
  });
});
