/**
 * The page that compares Stigmer with Claude Managed Agents.
 *
 * Pins that every statement about Managed Agents links the Anthropic page it
 * comes from and that the page says when those pages were read, so a fact
 * that goes stale can be traced and re-read. Pins too that the page names no
 * Managed Agents beta version and no Anthropic SDK release: the compatibility
 * claim is stated once, on the docs page this one links, and
 * scripts/managed-agents-claim.test.mjs holds that copy to the versions the
 * tests run. And pins that a reader already on Managed Agents is sent first
 * to the docs page that maps each Managed Agents idea to Stigmer's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ANTHROPIC_SOURCES,
  CompareManagedAgentsPage,
  SOURCES_READ_ON,
} from "../CompareManagedAgentsPage";

afterEach(cleanup);

const SOURCE_URLS = new Set<string>(Object.values(ANTHROPIC_SOURCES).map((source) => source.href));

describe("CompareManagedAgentsPage", () => {
  it("cites an Anthropic page for every Managed Agents answer", () => {
    render(<CompareManagedAgentsPage />);

    const rows = screen.getAllByRole("row").filter((row) => row.querySelector('[role="rowheader"]'));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      const managedAgents = row.querySelectorAll('[role="cell"]')[0];
      const cited = [...managedAgents.querySelectorAll("a")].map((link) => link.getAttribute("href"));
      expect(
        cited.some((href) => href !== null && SOURCE_URLS.has(href)),
        row.querySelector('[role="rowheader"]')?.textContent ?? "",
      ).toBe(true);
    }
  });

  it("says when Anthropic's pages were read, and whose products they describe", () => {
    const { container } = render(<CompareManagedAgentsPage />);
    const text = container.textContent ?? "";

    expect(text).toContain(`read on ${SOURCES_READ_ON}`);
    expect(text).toContain("Claude and Claude Managed Agents are Anthropic's products.");
  });

  it("names no beta version or SDK release, and links the page that does", () => {
    const { container } = render(<CompareManagedAgentsPage />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/managed-agents-\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/@anthropic-ai\/sdk/);
    expect(container.querySelector('a[href="/docs/sdk/managed-agents"]')).not.toBeNull();
  });

  it("sends readers already on Managed Agents to the docs' concept-by-concept mapping first", () => {
    render(<CompareManagedAgentsPage />);
    const section = screen.getByRole("heading", { name: "Already on Managed Agents?" }).closest("section");

    const first = section?.querySelector("p a");
    expect(first?.getAttribute("href")).toBe("/docs/concepts/coming-from-claude-managed-agents");
  });
});
