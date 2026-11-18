/**
 * Pins the organization gate's screens, which both consoles draw on the
 * standalone frame: the app when an organization is ready or the route
 * bypasses the gate; "Loading your organizations…" while the list loads; the
 * failure said from its kind ("Stigmer couldn't load your organizations."
 * with what wasn't lost and Try again), with the help line (CON-13); and,
 * for a person in none, the screen said from their side with the form to
 * make their first, handing the new organization to the host. The host's
 * corner (who is signed in, Sign out) stays on every screen a person can be
 * stuck on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrgGateView } from "../OrgGateView";

// The help line reads the server's answer, and the form makes the
// organization through the client; here both stand in, so the test holds
// where the gate places them and what it does with the form's result.
vi.mock("../../help/HelpLink.js", () => ({
  HelpLink: () => <p>Stuck? Talk to us</p>,
  FailureHelpLine: () => <p>Stuck? Talk to us</p>,
}));
vi.mock("../../organization/CreateOrganizationForm.js", () => ({
  CreateOrganizationForm: ({ onCreated }: { onCreated: (org: Organization) => void }) => (
    <button type="button" onClick={() => onCreated({ metadata: { id: "org_new", slug: "new-org" } } as Organization)}>
      create org
    </button>
  ),
}));

afterEach(cleanup);

const corner = <button type="button">Sign out</button>;
const unavailable = new ConnectError("the server did not answer in time", Code.Unavailable);

describe("OrgGateView", () => {
  it("draws the app when an organization is ready, and when the route bypasses the gate", () => {
    const { rerender } = render(
      <OrgGateView state={{ status: "ready" }} retry={vi.fn()} onCreated={vi.fn()} corner={corner}>
        <p>the app</p>
      </OrgGateView>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
    rerender(
      <OrgGateView state={{ status: "bypassed" }} retry={vi.fn()} onCreated={vi.fn()} corner={corner}>
        <p>the app</p>
      </OrgGateView>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("says it is loading the person's organizations", () => {
    render(
      <OrgGateView state={{ status: "loading" }} retry={vi.fn()} onCreated={vi.fn()} corner={corner}>
        <p>the app</p>
      </OrgGateView>,
    );
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading your organizations…");
  });

  it("says the failure in plain words, with the help line and the corner, and retries on request", async () => {
    const retry = vi.fn();
    render(
      <OrgGateView state={{ status: "error", message: unavailable.message, error: unavailable }} retry={retry} onCreated={vi.fn()} corner={corner} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Stigmer couldn't load your organizations.");
    expect(alert.textContent).toContain("You're signed in, and nothing was lost.");
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("tells a person in no organization so from their side, and hands their first to the host", async () => {
    const onCreated = vi.fn();
    render(<OrgGateView state={{ status: "no-orgs" }} retry={vi.fn()} onCreated={onCreated} corner={corner} />);
    expect(screen.getByRole("heading", { level: 1, name: "You're not in an organization yet" })).toBeTruthy();
    expect(screen.getByText("Make one to start, or ask an admin of an existing one to invite you.")).toBeTruthy();
    expect(screen.queryByText(/top-level context/)).toBeNull();
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "create org" }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ id: "org_new" }) }));
  });
});
