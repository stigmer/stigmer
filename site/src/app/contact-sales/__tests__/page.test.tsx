/**
 * The `/contact-sales` route: Next metadata describing the Enterprise
 * conversation for search and link previews, and a page that renders the
 * contact form with what an Enterprise plan includes.
 *
 * Pins the route's metadata copy and the page's offer (dedicated
 * infrastructure, SLAs, custom contracts), and that neither sells single
 * sign-on: company sign-in is the customer's identity provider's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import Page, { metadata } from "../page";

afterEach(() => {
  cleanup();
});

describe("/contact-sales route", () => {
  it("describes the Enterprise conversation in its metadata", () => {
    expect(metadata.title).toBe("Contact Sales");
    expect(metadata.description).toBe(
      "Talk to the Stigmer team about Enterprise plans — dedicated infrastructure, SLAs, and custom contracts.",
    );
    expect(metadata.openGraph?.title).toBe(`Contact Sales | ${SITE_CONFIG.name}`);
    expect(JSON.stringify(metadata)).not.toMatch(/\bSSO\b|SAML|single sign-on/i);
  });

  it("renders the contact form with what an Enterprise plan includes", () => {
    const { container } = render(<Page />);

    expect(
      screen.getByText(/Enterprise plans include dedicated infrastructure, SLAs, and custom contracts\./),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bSSO\b|SAML/);
  });
});
