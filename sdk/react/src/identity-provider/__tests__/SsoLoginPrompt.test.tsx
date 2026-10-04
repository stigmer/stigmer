/**
 * SsoLoginPrompt's lookup state (stigmer#1653): while the org's SSO provider
 * is looked up, the region is busy and named in full for a screen reader
 * ("Looking up SSO provider for acme") by LoadingRegion's hidden text, and the
 * short visible line ("Looking up acme…") is hidden from assistive tech so the
 * name is read once. A shared sign-in link names the organization by its
 * minted id, which means nothing to the person following it, so no phase
 * echoes an id: the found phase's button names the provider instead. The
 * lookup hook is mocked into each phase.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const lookup = vi.hoisted(() => ({
  state: {
    ssoProvider: null as { displayName: string } | null,
    isLoading: true,
    error: null as Error | null,
  },
}));
vi.mock("../useSsoProvider.js", () => ({
  useSsoProvider: () => lookup.state,
}));

const ORG_ID = "org_01j9z3k8f2q4m6n7p8r9s0t1v2";

import { SsoLoginPrompt } from "../SsoLoginPrompt.js";

afterEach(() => {
  cleanup();
  lookup.state = { ssoProvider: null, isLoading: true, error: null };
});

describe("SsoLoginPrompt — while the provider is looked up", () => {
  it("names the busy region in full with hidden text and hides the short visible line", () => {
    render(<SsoLoginPrompt initialOrg="acme" onSsoLogin={vi.fn()} />);

    const name = screen.getByText("Looking up SSO provider for acme");
    expect(name.className).toBe("stg:sr-only");
    const region = name.closest('[aria-busy="true"]');
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-label")).toBeNull();
    expect(region!.getAttribute("role")).toBeNull();

    const visible = screen.getByText("acme").closest("p");
    expect(visible?.textContent).toBe("Looking up acme…");
    expect(visible?.getAttribute("aria-hidden")).toBe("true");
    expect(region!.contains(visible)).toBe(true);
  });
});

describe("SsoLoginPrompt — a sign-in link that names the organization by id", () => {
  it("looks up without echoing the id", () => {
    render(<SsoLoginPrompt initialOrg={ORG_ID} onSsoLogin={vi.fn()} />);

    expect(screen.getByText("Looking up SSO provider").className).toBe("stg:sr-only");
    expect(document.body.textContent).toContain("Looking up SSO provider…");
    expect(document.body.textContent).not.toContain(ORG_ID);
  });

  it("names the provider, not the id, once found", () => {
    lookup.state = { ssoProvider: { displayName: "Acme Okta" }, isLoading: false, error: null };
    render(<SsoLoginPrompt initialOrg={ORG_ID} onSsoLogin={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Sign in with Acme Okta/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Signing in to");
    expect(document.body.textContent).not.toContain(ORG_ID);
  });

  it("says the link has no provider, without the id, when none is configured", () => {
    lookup.state = { ssoProvider: null, isLoading: false, error: null };
    render(<SsoLoginPrompt initialOrg={ORG_ID} onSsoLogin={vi.fn()} />);

    expect(screen.getByText("No SSO provider is configured for this sign-in link.")).toBeTruthy();
    expect(document.body.textContent).not.toContain(ORG_ID);
  });

  it("still names a typed slug once found", () => {
    lookup.state = { ssoProvider: { displayName: "Acme Okta" }, isLoading: false, error: null };
    render(<SsoLoginPrompt initialOrg="acme" onSsoLogin={vi.fn()} />);

    expect(document.body.textContent).toContain("Signing in to acme");
  });
});
