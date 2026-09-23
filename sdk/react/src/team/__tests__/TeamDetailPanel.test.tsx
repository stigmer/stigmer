/**
 * Pins TeamDetailPanel's save payload against the full-resource replace:
 * an edit spreads `toTeamUpdateInput(team)` and overrides only the name and
 * description, so the fields the form does not show (the id it addresses
 * the update by, the slug, labels) survive the save. The members panel and
 * the permission gate are stubbed; they are proven elsewhere.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { TeamSchema, type Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import type { TeamInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";

vi.mock("../TeamMembersPanel.js", () => ({
  TeamMembersPanel: () => <div data-testid="members" />,
}));
vi.mock("../../iam-policy/PermissionGate.js", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { TeamDetailPanel } from "../TeamDetailPanel";

const TEAM: Team = create(TeamSchema, {
  metadata: {
    id: "tm_sre",
    name: "Site Reliability",
    slug: "site-reliability",
    org: "acme",
    labels: { cost_center: "ops" },
  },
  spec: { description: "On call" },
});

afterEach(cleanup);

describe("TeamDetailPanel save payload", () => {
  it("keeps the id, slug and labels when only the description is edited", async () => {
    const update = vi.fn(async (_input: TeamInput) => TEAM);
    render(
      <StigmerContext.Provider value={{ team: { update } } as never}>
        <TeamDetailPanel team={TEAM} orgId="org_acme" />
      </StigmerContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Pages at night" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toEqual({
      id: "tm_sre",
      name: "Site Reliability",
      slug: "site-reliability",
      org: "acme",
      labels: { cost_center: "ops" },
      visibility: undefined,
      description: "Pages at night",
    });
  });
});
