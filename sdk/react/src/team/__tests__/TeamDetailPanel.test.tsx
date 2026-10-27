/**
 * Pins TeamDetailPanel's save payload: an edit names the name and the
 * description alone, on the team's id, so the fields the form does not
 * show (the slug, the labels) keep their stored values; and a delete the
 * server refuses stays on the confirmation with the refusal's message. The
 * members panel and the permission gate are stubbed; they are proven
 * elsewhere.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import { TeamSchema, type Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { StigmerContext } from "../../context";

vi.mock("../TeamMembersPanel.js", () => ({
  TeamMembersPanel: () => <div data-testid="members" />,
}));
vi.mock("../../grant/PermissionGate.js", () => ({
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
  it("names the name and description alone, on the team's id, when only the description is edited", async () => {
    const update = vi.fn(async (_resource: Team, _paths: string[]) => TEAM);
    render(
      <StigmerContext.Provider
        value={{ team: { update }, grant: { checkMyPermission: async () => ({ isAuthorized: false }) } } as never}
      >
        <TeamDetailPanel team={TEAM} org="org_acme" />
      </StigmerContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Pages at night" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Team>(update);
    // The form's two fields by their paths: the slug and the labels keep
    // their stored values without being sent back.
    expect(sent.paths).toEqual(["metadata.name", "spec.description"]);
    expect(sent.id).toBe("tm_sre");
    expect(sent.resource.metadata?.name).toBe("Site Reliability");
    expect(sent.resource.spec?.description).toBe("Pages at night");
  });
});

describe("TeamDetailPanel rename", () => {
  it("renames through the kind's rename for whoever may delete it, and hands the renamed resource to onUpdated", async () => {
    const renamed = clone(TeamSchema, TEAM);
    if (renamed.metadata !== undefined) {
      renamed.metadata.slug = "renamed-slug";
    }
    const rename = vi.fn(async () => renamed);
    const onUpdated = vi.fn();
    const client = {
      team: { rename },
      grant: { checkMyPermission: async () => ({ isAuthorized: true }) },
    } as never;
    render(
      <StigmerContext.Provider value={client}>
        <TeamDetailPanel team={TEAM} org="org_acme" onUpdated={onUpdated} />
      </StigmerContext.Provider>,
    );

    fireEvent.change(await screen.findByLabelText("Slug", undefined, { timeout: 5000 }), {
      target: { value: "renamed-slug" },
    });
    const button = screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
    // The field settles before it takes the rename, however slow the runner.
    await waitFor(() => expect(button.disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(button);

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(renamed), { timeout: 5000 });
    expect(rename.mock.calls[0]).toEqual([expect.objectContaining({ resourceId: TEAM.metadata?.id, slug: "renamed-slug" })]);
  });
});

describe("TeamDetailPanel delete refusal", () => {
  it("keeps the confirmation open with the refusal's message as an alert, and reports no delete", async () => {
    const del = vi.fn(async () => {
      throw new Error("the team still holds grants");
    });
    const onDeleted = vi.fn();
    render(
      <StigmerContext.Provider
        value={{ team: { delete: del }, grant: { checkMyPermission: async () => ({ isAuthorized: false }) } } as never}
      >
        <TeamDetailPanel team={TEAM} org="org_acme" onDeleted={onDeleted} />
      </StigmerContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete team" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete team" }));

    const message = await screen.findByText("the team still holds grants");
    expect(message.getAttribute("role")).toBe("alert");
    expect(del).toHaveBeenCalledWith({ resourceId: "tm_sre" });
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
