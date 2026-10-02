/**
 * SsoLoginPrompt's lookup state (stigmer#1653): while the org's SSO provider
 * is looked up, the region is busy and named in full for a screen reader
 * ("Looking up SSO provider for acme") by LoadingRegion's hidden text, and the
 * short visible line ("Looking up acme…") is hidden from assistive tech so the
 * name is read once. The lookup hook is mocked into its loading state; the
 * other phases are the hook's and the panel's business.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../useSsoProvider.js", () => ({
  useSsoProvider: () => ({ ssoProvider: null, isLoading: true, error: null }),
}));

import { SsoLoginPrompt } from "../SsoLoginPrompt.js";

afterEach(cleanup);

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
