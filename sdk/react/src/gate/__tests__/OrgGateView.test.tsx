/**
 * Pins the organization gate's screens, which both consoles draw: the app
 * when an organization is ready or the route bypasses the gate; a quiet
 * wait while the list loads; the failure with the server's line, Try again
 * and the help line (CON-13); and, for a person in none, the welcome and the
 * form to make their first, handing the new organization to the host. The
 * host's corner (who is signed in, Sign out) stays on every screen a person
 * can be stuck on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrgGateView } from "../OrgGateView";

// The help line reads the server's answer, and the form makes the
// organization through the client; here both stand in, so the test holds
// where the gate places them and what it does with the form's result.
vi.mock("../../help/HelpLink.js", () => ({ HelpLink: () => <p>Stuck? Talk to us</p> }));
vi.mock("../../organization/CreateOrganizationForm.js", () => ({
  CreateOrganizationForm: ({ onCreated }: { onCreated: (org: Organization) => void }) => (
    <button type="button" onClick={() => onCreated({ metadata: { id: "org_new", slug: "new-org" } } as Organization)}>
      create org
    </button>
  ),
}));

afterEach(cleanup);

const corner = <button type="button">Sign out</button>;

describe("OrgGateView", () => {
  it.each([[{ status: "ready" } as const], [{ status: "bypassed" } as const]])("draws the app for %o", (state) => {
    render(
      <OrgGateView state={state} retry={vi.fn()} onCreated={vi.fn()} corner={corner}>
        <p>the app</p>
      </OrgGateView>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("holds the app back while the organizations load, without the corner", () => {
    render(
      <OrgGateView state={{ status: "loading" }} retry={vi.fn()} onCreated={vi.fn()} corner={corner}>
        <p>the app</p>
      </OrgGateView>,
    );
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("shows the failure with its message, the help line and the corner, and retries on request", async () => {
    const retry = vi.fn();
    render(<OrgGateView state={{ status: "error", message: "organizations unavailable" }} retry={retry} onCreated={vi.fn()} corner={corner} />);
    expect(screen.getByText("Failed to load organizations")).toBeTruthy();
    expect(screen.getByText("organizations unavailable")).toBeTruthy();
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("welcomes a person in no organization and hands over the one they make", async () => {
    const onCreated = vi.fn();
    render(<OrgGateView state={{ status: "no-orgs" }} retry={vi.fn()} onCreated={onCreated} corner={corner} />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to Stigmer" })).toBeTruthy();
    expect(screen.getByText(/ask one of its admins to invite you/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "create org" }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ metadata: { id: "org_new", slug: "new-org" } }));
  });
});
