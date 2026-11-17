/**
 * The read-only agent page's instructions: text taller than the clamp
 * shows a "Show more" button, and that button tells a screen reader whether
 * the instructions are open and names the block it opens
 * (stigmer/stigmer#2909). happy-dom lays nothing out, so the block's heights
 * are stubbed to read as overflowing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { samples } from "@stigmer/react-core/test";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

const INSTRUCTIONS = "Answer tickets.\nEscalate refunds.";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

// A pre reads as taller than its clamp, so the view offers "Show more";
// deleting the stubs afterwards leaves the inherited HTMLElement getters.
beforeAll(() => {
  Object.defineProperty(HTMLPreElement.prototype, "scrollHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLPreElement.prototype, "clientHeight", { configurable: true, get: () => 192 });
});
afterAll(() => {
  delete (HTMLPreElement.prototype as { scrollHeight?: number }).scrollHeight;
  delete (HTMLPreElement.prototype as { clientHeight?: number }).clientHeight;
});

describe("AgentDetailView: the instructions' Show more", () => {
  it("says whether the instructions are open, and names the block it opens", async () => {
    const agent = samples.agent({ name: "Analyst", org: ACME_ID });
    agent.spec!.instructions = INSTRUCTIONS;
    render(<AgentDetailView org="acme" slug="analyst" />, {
      wrapper: orgWrapper({
        agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      }),
    });

    const toggle = await screen.findByRole("button", { name: "Show more" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const block = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(block?.textContent).toBe(INSTRUCTIONS);

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  });
});
