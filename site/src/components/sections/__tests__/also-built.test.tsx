/**
 * The three more things we built, after the hard parts: one card each, its
 * title a heading and its proof linked; the Managed Agents card quotes the
 * test that drives Anthropic's SDK, links the comparison, and never calls
 * Stigmer a drop-in replacement.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ALSO_BUILT } from "../../../../../brand/agent-gets";
import { AlsoBuilt } from "../AlsoBuilt";

afterEach(cleanup);

describe("AlsoBuilt", () => {
  it("shows the three, each with a link to its proof", () => {
    render(<AlsoBuilt />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(
      ALSO_BUILT.map((also) => also.title),
    );
    for (const also of ALSO_BUILT) {
      expect(within(screen.getByRole("article", { name: also.title })).getAllByRole("link").length).toBeGreaterThan(0);
    }
  });

  it("quotes Anthropic's SDK reading a session, links the comparison, and never says drop-in", () => {
    const { container } = render(<AlsoBuilt />);
    const card = within(screen.getByRole("article", { name: "Anthropic's SDK reads your sessions" }));
    expect(card.getByText(/the stream yields its events in log order to end_turn/)).toBeTruthy();
    expect(card.getByRole("link", { name: "Compare with Managed Agents" }).getAttribute("href")).toBe("/compare/claude-managed-agents");
    expect(container.textContent).not.toMatch(/drop-in/i);
  });
});
