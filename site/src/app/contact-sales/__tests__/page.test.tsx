/**
 * The `/contact-sales` route: Next metadata describing the Enterprise
 * conversation for search and link previews, and a page that renders the
 * contact form naming both forms of Enterprise.
 *
 * Pins the route's metadata copy and the page's offer (Stigmer Enterprise on
 * the customer's own infrastructure, or Enterprise Cloud run by us), and that
 * neither sells single sign-on (company sign-in is the customer's identity
 * provider's) or an SLA nobody has defined.
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
      "Talk to the Stigmer team about Stigmer Enterprise on your own infrastructure, or Enterprise Cloud run by us, on an annual contract.",
    );
    expect(metadata.openGraph?.title).toBe(`Contact Sales | ${SITE_CONFIG.name}`);
    expect(metadata.openGraph?.description).toBe(
      "Talk to the Stigmer team about Stigmer Enterprise or Enterprise Cloud.",
    );
    expect(JSON.stringify(metadata)).not.toMatch(/\bSSO\b|SAML|single sign-on/i);
    expect(JSON.stringify(metadata)).not.toMatch(/\bSLAs?\b/);
  });

  it("renders the contact form with what an Enterprise plan includes", () => {
    const { container } = render(<Page />);

    expect(
      screen.getByText(
        /Stigmer Enterprise on your own infrastructure, or Enterprise Cloud run by us: tell us which, and about your use case/,
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bSSO\b|SAML/);
    expect(container.textContent).not.toMatch(/\bSLAs?\b/);
  });
});
