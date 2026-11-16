/**
 * A detail page's outline stays in order whatever level its title takes: a
 * section's title is one level under the page's title, and a heading inside
 * a section one under that. The console's pages pass `headingLevel` 1; a host
 * that embeds a view under its own heading keeps the default 2.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../organization/useOrgRefs", () => ({
  useOrgSlugForId: () => (id: string) => id,
}));
// The acts beside the header ask the server what the viewer may do; the
// outline is what this suite reads.
vi.mock("../ResourceActionBar", () => ({ ResourceActionBar: () => null }));

import { Section } from "../Section";
import { SubHeading } from "../headingLevel";
import { ResourceDetailShell } from "../ResourceDetailShell";

afterEach(cleanup);

function page(headingLevel?: 1 | 2) {
  return render(
    <ResourceDetailShell header={{ id: "plg_1", name: "ledger-tools", org: "acme" }} headingLevel={headingLevel}>
      <Section title="What it brings">
        <SubHeading>Not run on Stigmer</SubHeading>
      </Section>
    </ResourceDetailShell>,
  );
}

describe("a detail page's heading levels", () => {
  it("puts sections under an h1 title at h2, and their inner headings at h3", () => {
    page(1);
    expect(screen.getByRole("heading", { name: "ledger-tools" }).tagName).toBe("H1");
    expect(screen.getByRole("heading", { name: "What it brings" }).tagName).toBe("H2");
    expect(screen.getByRole("heading", { name: "Not run on Stigmer" }).tagName).toBe("H3");
  });

  it("puts sections under the default h2 title at h3, and their inner headings at h4", () => {
    page();
    expect(screen.getByRole("heading", { name: "ledger-tools" }).tagName).toBe("H2");
    expect(screen.getByRole("heading", { name: "What it brings" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Not run on Stigmer" }).tagName).toBe("H4");
  });
});
