/**
 * One proof drawn by its kind: a test's words quoted with its file linked on
 * GitHub at `main`, a file linked on GitHub, a site page linked in place, and
 * the measured wake with its figures read from brand/measurements.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { SANDBOX_WAKE, formatSeconds } from "../../../../../../brand/measurements";
import { Proof } from "../Proof";
import { fileName, proofHref } from "../links";

afterEach(cleanup);

describe("Proof", () => {
  it("quotes each case of a test and links the file on GitHub", () => {
    render(<Proof proof={{ kind: "tests", path: "test/conformance/src/a.conformance.test.ts", cases: ["one case", "another case"] }} />);
    expect(screen.getByText("Tested in CI")).toBeTruthy();
    expect(screen.getAllByRole("blockquote").map((quote) => quote.textContent)).toEqual(["“one case”", "“another case”"]);
    expect(screen.getByRole("link", { name: "a.conformance.test.ts" }).getAttribute("href")).toBe(
      `${SITE_CONFIG.githubUrl}/blob/main/test/conformance/src/a.conformance.test.ts`,
    );
  });

  it("links a repository file on GitHub and a site page in place", () => {
    render(<Proof proof={{ kind: "source", label: "The licence", href: "LICENSE" }} />);
    render(<Proof proof={{ kind: "source", label: "Self-hosting", href: "/docs/guides/self-hosting/overview" }} />);
    expect(screen.getByRole("link", { name: "The licence" }).getAttribute("href")).toBe(`${SITE_CONFIG.githubUrl}/blob/main/LICENSE`);
    expect(screen.getByRole("link", { name: "Self-hosting" }).getAttribute("href")).toBe("/docs/guides/self-hosting/overview");
    expect(screen.getByText("stigmer/stigmer · LICENSE")).toBeTruthy();
    expect(screen.getByText("stigmer.ai/docs/guides/self-hosting/overview")).toBeTruthy();
  });

  it("opens a drawn picture's sharpest file on a click", () => {
    render(<Proof proof={{ kind: "screen", name: "asks-first", alt: "The ledger agent asks first" }} />);
    const picture = screen.getByRole("img", { name: "The ledger agent asks first" });
    expect(picture.closest("a")?.getAttribute("href")).toBe("/screens/asks-first-2x.webp");
    expect(picture.getAttribute("sizes")).toBe("(min-width: 1024px) 700px, 100vw");
  });

  it("prints every wake figure from the measurement, the new conversation's too", () => {
    render(<Proof proof={{ kind: "measurement", figure: "sandbox-wake" }} />);
    const fresh = SANDBOX_WAKE.paths.new;
    expect(screen.getByText(new RegExp(`its sandbox created: ${formatSeconds(fresh.working.p50)} \\(${fresh.n} conversations\\)`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`p95 ${formatSeconds(SANDBOX_WAKE.paths.storage.working.p95)} · ${SANDBOX_WAKE.paths.storage.n} wakes`))).toBeTruthy();
  });

  it("names a file by the last part of its path", () => {
    expect(fileName("test/conformance/README.md")).toBe("README.md");
    expect(fileName("LICENSE")).toBe("LICENSE");
    expect(proofHref("/compare/claude-managed-agents")).toBe("/compare/claude-managed-agents");
  });
});
