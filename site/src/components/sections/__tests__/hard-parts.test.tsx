/**
 * The homepage's hard parts: the five worries in the brand's order, each a
 * heading with what you'd build, what Stigmer gives and its docs page, each
 * with its proof (the measured wake for the sandbox, the drawn approval
 * picture, a public test's own words, the licence and the self-hosting
 * guide); the line on where the tests live; and the turn line with the
 * hero's two buttons. It replaces the old table and cards, which said the
 * same five twice.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { AGENT_GETS } from "@/lib/agent-gets";
import { AGENT_GET_CLAIMS, AGENT_GET_ORDER } from "../../../../../brand/agent-gets";
import { SANDBOX_WAKE, formatSeconds } from "../../../../../brand/measurements";
import { HardParts, TURN_LINE } from "../HardParts";

afterEach(cleanup);

const row = (id: string) => screen.getByRole("article", { name: AGENT_GET_CLAIMS[id as keyof typeof AGENT_GET_CLAIMS].worry });

describe("HardParts", () => {
  it("asks the five worries in the brand's order, the sandbox first", () => {
    render(<HardParts />);
    const worries = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(worries).toEqual(AGENT_GET_ORDER.map((id) => AGENT_GET_CLAIMS[id].worry));
    expect(worries[0]).toBe("Can the agent's code touch your servers?");
  });

  it("gives each worry what you'd build, what Stigmer gives, and its docs page", () => {
    render(<HardParts />);
    for (const id of AGENT_GET_ORDER) {
      const article = within(row(id));
      expect(article.getByText(AGENT_GET_CLAIMS[id].build)).toBeTruthy();
      expect(article.getByText(AGENT_GET_CLAIMS[id].gives)).toBeTruthy();
      expect(article.getByRole("link", { name: AGENT_GETS[id].cta }).getAttribute("href")).toBe(AGENT_GETS[id].href);
    }
  });

  it("proves the sandbox with the wake measured on Stigmer Cloud, its date and its method", () => {
    render(<HardParts />);
    const sandbox = within(row("own-computer"));
    const { node, storage } = SANDBOX_WAKE.paths;
    expect(sandbox.getByText(formatSeconds(node.working.p50))).toBeTruthy();
    expect(sandbox.getByText(formatSeconds(storage.working.p50))).toBeTruthy();
    expect(sandbox.getByText(new RegExp(`${formatSeconds(node.resume.p50)} of it waking the sandbox`))).toBeTruthy();
    expect(sandbox.getByText(/Stigmer Cloud, preprod · October 31, 2026/)).toBeTruthy();
    expect(sandbox.getByRole("link", { name: "How we measured" }).getAttribute("href")).toBe(
      "/docs/guides/self-hosting/runners#sessions-that-sleep-with-the-substrate-driver",
    );
  });

  it("proves asking first with the drawn Northwind picture and the approval test", () => {
    render(<HardParts />);
    const asks = within(row("asks-first"));
    const picture = asks.getByRole("img", { name: /ledger agent stops before it posts an adjustment/ });
    expect(picture.getAttribute("src")).toBe("/screens/asks-first-1x.webp");
    expect(asks.getByText(/the shell call waits before it runs/)).toBeTruthy();
    expect(asks.getByRole("link", { name: "run-approval.conformance.test.ts" }).getAttribute("href")).toBe(
      `${SITE_CONFIG.githubUrl}/blob/main/test/conformance/src/suites-execution/run-approval.conformance.test.ts`,
    );
  });

  it("proves surviving restarts with the server rolled out mid-turn, and keys with the licence and self-hosting", () => {
    render(<HardParts />);
    expect(within(row("hours")).getByText(/a server rolled out mid-turn costs a watcher no event/)).toBeTruthy();
    const keys = within(row("keys"));
    expect(keys.getByRole("link", { name: "The Apache 2.0 license" }).getAttribute("href")).toBe(`${SITE_CONFIG.githubUrl}/blob/main/LICENSE`);
    expect(keys.getByRole("link", { name: "Run it on your own servers" }).getAttribute("href")).toBe("/docs/guides/self-hosting/overview");
  });

  it("says where the tests live, then turns to the two buttons", () => {
    render(<HardParts />);
    expect(screen.getByText(/Every test named here is in the open-source repository/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "The conformance suite" }).getAttribute("href")).toBe(
      `${SITE_CONFIG.githubUrl}/blob/main/test/conformance/README.md`,
    );
    expect(screen.getByText(TURN_LINE).textContent).toBe("You could build all of that. Or use Stigmer.");
    expect(screen.getByRole("link", { name: "Start free" }).getAttribute("href")).toBe(SITE_CONFIG.cloudSignupUrl);
    expect(screen.getByRole("link", { name: "Run the quickstart" }).getAttribute("href")).toBe("/docs/getting-started/quickstart");
  });
});
