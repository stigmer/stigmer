/**
 * The agent page for an agent the server does not know: a not-found answer
 * is no failure, so the page says "Agent not found" with why, in place of
 * the agent and its acts, and offers no retry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StigmerError } from "@stigmer/client";
import { AgentDetailView } from "../AgentDetailView";
import { orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);

/** Connect's NotFound code. */
const CODE_NOT_FOUND = 5;

describe("AgentDetailView: an agent the server does not know", () => {
  it("says the agent was not found, with no acts and no retry", async () => {
    const getByReference = vi.fn(async () => {
      throw new StigmerError("not-found", "agent not found", CODE_NOT_FOUND);
    });
    render(<AgentDetailView org="acme" slug="ghost-bot" />, {
      wrapper: orgWrapper({
        agent: { getByReference, update: vi.fn() },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: true })) },
      }),
    });

    expect(await screen.findByText("Agent not found")).toBeTruthy();
    expect(screen.getByText("This agent doesn't exist or you don't have access to it.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(getByReference).toHaveBeenCalled();
  });
});
