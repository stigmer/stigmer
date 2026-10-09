import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VendorApprovalBlockedNotice } from "../VendorApprovalBlockedNotice";

afterEach(cleanup);

/**
 * The copy contract for the vendor-approval-blocked state lives here.
 *
 * The invariant under test (stigmer/stigmer#412): the notice must never
 * recommend a path that does not exist. "Enter a token manually" may only
 * appear when the endpoint accepts static tokens; when it does not, the
 * notice still explains the state and names what an admin can do — a
 * disabled button is never the only signal.
 */

const DOCS_URL = "https://vendor.example.com/oauth-docs";

function renderNotice(
  overrides: Partial<Parameters<typeof VendorApprovalBlockedNotice>[0]> = {},
) {
  return render(
    <VendorApprovalBlockedNotice
      blocked
      pending
      manualEntrySupported
      docsUrl={null}
      {...overrides}
    />,
  );
}

describe("VendorApprovalBlockedNotice — self-gating", () => {
  it("renders nothing when not blocked", () => {
    const { container } = renderNotice({ blocked: false });
    expect(container.innerHTML).toBe("");
  });
});

describe("VendorApprovalBlockedNotice — status sentence honesty", () => {
  it("says awaiting approval for a PENDING app", () => {
    renderNotice({ pending: true });
    expect(screen.getByText(/is awaiting vendor approval/)).toBeTruthy();
  });

  it("says not approved for a REJECTED app — never 'pending'", () => {
    renderNotice({ pending: false });
    expect(screen.getByText(/was not approved by the vendor/)).toBeTruthy();
    expect(screen.queryByText(/awaiting vendor approval/)).toBeNull();
    expect(screen.queryByText(/pending/i)).toBeNull();
  });
});

describe("VendorApprovalBlockedNotice — alternative path", () => {
  it("offers manual entry where the endpoint takes a static token", () => {
    renderNotice({ manualEntrySupported: true });
    expect(
      screen.getByText(
        "The login app for this server is awaiting vendor approval. You can still connect by entering your own token manually.",
      ),
    ).toBeTruthy();
  });

  it("oauth_only: still explains itself with no false path", () => {
    renderNotice({ manualEntrySupported: false });
    expect(
      screen.getByText(/an admin adds another login app for this server's address\./),
    ).toBeTruthy();
    expect(screen.queryByText(/manually/)).toBeNull();
  });
});

describe("VendorApprovalBlockedNotice — the docs link", () => {
  it("links the docs when present", () => {
    renderNotice({ docsUrl: DOCS_URL });
    const link = screen.getByRole("link", { name: /Learn how to connect without it/ });
    expect(link.getAttribute("href")).toBe(DOCS_URL);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("offers no button: the alternatives are words and the docs link", () => {
    renderNotice({ manualEntrySupported: false, docsUrl: DOCS_URL });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("VendorApprovalBlockedNotice — compact variant", () => {
  it("carries the same copy contract at the dense size", () => {
    renderNotice({ compact: true, pending: false, manualEntrySupported: false, docsUrl: DOCS_URL });
    expect(screen.getByText(/was not approved by the vendor/)).toBeTruthy();
    expect(screen.queryByText(/manually/)).toBeNull();
    expect(screen.getByRole("link", { name: /Learn how to connect without it/ })).toBeTruthy();
  });
});
