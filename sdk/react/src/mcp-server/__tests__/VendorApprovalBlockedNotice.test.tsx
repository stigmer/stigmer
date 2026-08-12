import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { VendorApprovalBlockedNotice } from "../VendorApprovalBlockedNotice";

afterEach(cleanup);

/**
 * The copy contract for the vendor-approval-blocked state lives here.
 *
 * The invariant under test (stigmer/stigmer#412): the notice must never
 * recommend a path that does not exist. "Enter a token manually" may only
 * appear when the endpoint accepts static tokens; "use your own OAuth app"
 * only when BYOA is relevant; and when neither exists the notice must still
 * explain the state — a disabled button is never the only signal.
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
      canBringOwnApp={false}
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
    expect(
      screen.getByText(/is awaiting vendor approval/),
    ).toBeTruthy();
  });

  it("says not approved for a REJECTED app — never 'pending'", () => {
    renderNotice({ pending: false });
    expect(
      screen.getByText(/was not approved by the vendor/),
    ).toBeTruthy();
    expect(screen.queryByText(/awaiting vendor approval/)).toBeNull();
    expect(screen.queryByText(/pending/i)).toBeNull();
  });
});

describe("VendorApprovalBlockedNotice — alternative-path matrix", () => {
  it("BYOA + manual: offers both (the copy depicted in the byoa-setup tour, byte-stable)", () => {
    renderNotice({ canBringOwnApp: true, manualEntrySupported: true });
    expect(
      screen.getByText(
        "The platform's OAuth app is awaiting vendor approval. You can use your own OAuth app or enter a token manually.",
      ),
    ).toBeTruthy();
  });

  it("BYOA + oauth_only: offers BYOA and never mentions manual entry", () => {
    renderNotice({ canBringOwnApp: true, manualEntrySupported: false });
    expect(screen.getByText(/You can use your own OAuth app\./)).toBeTruthy();
    expect(screen.queryByText(/manually/)).toBeNull();
  });

  it("no BYOA + manual: offers manual entry", () => {
    renderNotice({ canBringOwnApp: false, manualEntrySupported: true });
    expect(
      screen.getByText(/You can still connect by entering your own token manually\./),
    ).toBeTruthy();
  });

  it("no BYOA + oauth_only: still explains itself with no false path", () => {
    renderNotice({ canBringOwnApp: false, manualEntrySupported: false });
    expect(
      screen.getByText(/OAuth sign-in is temporarily unavailable for this server\./),
    ).toBeTruthy();
    expect(screen.queryByText(/manually/)).toBeNull();
    expect(screen.queryByText(/your own OAuth app/)).toBeNull();
  });
});

describe("VendorApprovalBlockedNotice — affordances", () => {
  it("renders the BYOA call-to-action and routes clicks", () => {
    const onBringOwnApp = vi.fn();
    renderNotice({ canBringOwnApp: true, onBringOwnApp });

    fireEvent.click(
      screen.getByRole("button", { name: "Use your own OAuth app" }),
    );
    expect(onBringOwnApp).toHaveBeenCalledTimes(1);
  });

  it("omits the BYOA call-to-action when no action is wired, keeping the copy", () => {
    renderNotice({ canBringOwnApp: true });
    expect(
      screen.queryByRole("button", { name: "Use your own OAuth app" }),
    ).toBeNull();
    expect(screen.getByText(/You can use your own OAuth app/)).toBeTruthy();
  });

  it("links the docs when BYOA is not offered inline", () => {
    renderNotice({ canBringOwnApp: false, docsUrl: DOCS_URL });
    const link = screen.getByRole("link", {
      name: /Learn how to bring your own token/,
    });
    expect(link.getAttribute("href")).toBe(DOCS_URL);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("suppresses the docs link when the BYOA form (which carries it) is one click away", () => {
    renderNotice({ canBringOwnApp: true, docsUrl: DOCS_URL, onBringOwnApp: vi.fn() });
    expect(
      screen.queryByRole("link", { name: /Learn how to bring your own token/ }),
    ).toBeNull();
  });

  it("no-alternative floor: docs link is the way forward when present", () => {
    renderNotice({
      canBringOwnApp: false,
      manualEntrySupported: false,
      docsUrl: DOCS_URL,
    });
    expect(
      screen.getByRole("link", { name: /Learn how to bring your own token/ }),
    ).toBeTruthy();
  });
});

describe("VendorApprovalBlockedNotice — compact variant", () => {
  it("carries the same copy contract at the dense size", () => {
    renderNotice({
      compact: true,
      pending: false,
      canBringOwnApp: true,
      manualEntrySupported: false,
      onBringOwnApp: vi.fn(),
    });
    expect(screen.getByText(/was not approved by the vendor/)).toBeTruthy();
    expect(screen.queryByText(/manually/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use your own OAuth app" }),
    ).toBeTruthy();
  });
});
