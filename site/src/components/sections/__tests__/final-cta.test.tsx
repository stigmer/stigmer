/**
 * The landing page's closing call to action.
 *
 * Pins that it leads to the quickstart and to sign-up, and that it shows one
 * path, in one terminal, from install to the report: the closing section once
 * showed four SDK tabs, three of which no test ran and one of which named an
 * artifact that was never published. That its commands are the quickstart's
 * own is snippets.test.tsx's to prove.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { FinalCTA } from "../FinalCTA";

afterEach(cleanup);

describe("FinalCTA", () => {
  it("leads to sign-up and to the quickstart", () => {
    render(<FinalCTA />);

    expect(screen.getByRole("link", { name: /Start free/ }).getAttribute("href")).toBe(
      SITE_CONFIG.cloudSignupUrl,
    );
    expect(screen.getByRole("link", { name: "Run the quickstart" }).getAttribute("href")).toBe(
      "/docs/getting-started/quickstart",
    );
  });

  it("shows one terminal, from install to the report, and no language tabs", () => {
    const { container } = render(<FinalCTA />);

    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
    const lines = [...container.querySelectorAll("[data-code-line]")].map((line) => line.textContent);
    expect(lines[0]).toBe("brew install stigmer/tap/stigmer");
    expect(lines.at(-1)).toMatch(/^stigmer run variance-reporter .*--download \.\/out/);
  });
});
