/**
 * Pins how InvitationManager draws its links and what revoking one says:
 * a row's second line is its role, who it admits and how often it was used
 * ("Member · Anyone with the link · 3 joined"), an active link carries no
 * state pill and expires on a day ("Expires Aug 1"), and the revoke dialog
 * counts the people who joined with the link (a word up to ten) and names
 * the organization they stay in. A list that failed to load still offers
 * New invite link, and a link made from there is shown. The data hooks run
 * for real against a hand-built client.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { StigmerContext } from "@stigmer/react-core";
import { InvitationSchema, type Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { InvitationManager } from "../InvitationManager";

// The active organization, for how the revoke line names it.
vi.mock("../../organization/OrgProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../organization/OrgProvider.js")>()),
  useOptionalOrg: () => ({ activeOrg: { metadata: { id: "org_acme", slug: "acme" } } }),
}));

afterEach(cleanup);

const THIS_YEAR = new Date().getFullYear();

function link(
  id: string,
  label: string,
  opts: {
    role: IamRole;
    maxRedemptions: number;
    redemptionCount: number;
    state?: InvitationState;
    expiresAt?: Date;
  },
): Invitation {
  return create(InvitationSchema, {
    metadata: { id, name: id },
    spec: {
      label,
      role: opts.role,
      maxRedemptions: opts.maxRedemptions,
      expiresAt: timestampFromDate(opts.expiresAt ?? new Date(THIS_YEAR + 1, 7, 1, 12)),
    },
    status: { state: opts.state ?? InvitationState.active, redemptionCount: opts.redemptionCount, token: `tok_${id}` },
  });
}

function renderManager(
  list: () => Promise<{ entries: Invitation[]; nextPageToken: string }>,
  extra: Record<string, unknown> = {},
) {
  const client = {
    invitation: { list, revoke: vi.fn(), ...extra },
    grant: { checkMyPermission: async () => ({ isAuthorized: false }) },
    platform: { getServerInfo: async () => ({ singleOrg: false }) },
  };
  render(
    <StigmerContext.Provider value={client as never}>
      <InvitationManager org="org_acme" />
    </StigmerContext.Provider>,
  );
}

function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest("li");
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

describe("InvitationManager rows", () => {
  it("says each link's role, who it admits and how often it was used on its second line", async () => {
    renderManager(async () => ({
      entries: [
        link("inv_eng", "Engineering team invite", { role: IamRole.member, maxRedemptions: 0, redemptionCount: 3 }),
        link("inv_kat", "For Katherine", { role: IamRole.admin, maxRedemptions: 1, redemptionCount: 0 }),
        link("inv_ten", "Ten seats", { role: IamRole.viewer, maxRedemptions: 10, redemptionCount: 1 }),
      ],
      nextPageToken: "",
    }));

    expect(await screen.findByText("Member · Anyone with the link · 3 joined")).toBeTruthy();
    expect(screen.getByText("Admin · One person only · not used yet")).toBeTruthy();
    expect(screen.getByText("Viewer · Up to 10 people · 1 joined")).toBeTruthy();
  });

  it("draws no role tag or state pill on an active link, and a pill on one that no longer admits anyone", async () => {
    renderManager(async () => ({
      entries: [
        link("inv_eng", "Engineering team invite", { role: IamRole.member, maxRedemptions: 0, redemptionCount: 3 }),
        link("inv_old", "Old link", {
          role: IamRole.member,
          maxRedemptions: 0,
          redemptionCount: 0,
          state: InvitationState.revoked,
        }),
      ],
      nextPageToken: "",
    }));

    await screen.findByText("Engineering team invite");
    const active = rowOf("Engineering team invite");
    expect(within(active).queryByText("Active")).toBeNull();
    expect(within(active).getAllByText(/Member/)).toHaveLength(1);
    expect(within(rowOf("Old link")).getByText("Revoked")).toBeTruthy();
  });

  it("says an active link's expiry as a day, with the year only when it is not this year", async () => {
    const thisYear = new Date();
    thisYear.setDate(thisYear.getDate() + 6);
    renderManager(async () => ({
      entries: [
        link("inv_soon", "Soon", { role: IamRole.member, maxRedemptions: 0, redemptionCount: 0, expiresAt: thisYear }),
        link("inv_next", "Next year", {
          role: IamRole.member,
          maxRedemptions: 0,
          redemptionCount: 0,
          expiresAt: new Date(THIS_YEAR + 1, 7, 1, 12),
        }),
      ],
      nextPageToken: "",
    }));

    await screen.findByText("Soon");
    const day = thisYear.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(thisYear.getFullYear() === THIS_YEAR ? {} : { year: "numeric" }) });
    expect(within(rowOf("Soon")).getByText(`Expires ${day}`)).toBeTruthy();
    expect(within(rowOf("Next year")).getByText(`Expires Aug 1, ${THIS_YEAR + 1}`)).toBeTruthy();
    expect(screen.queryByText(/Expires in/)).toBeNull();
  });

  it("says an active link whose day has passed is expired, before the server marks it so", async () => {
    renderManager(async () => ({
      entries: [link("inv_late", "Late", { role: IamRole.member, maxRedemptions: 0, redemptionCount: 0, expiresAt: new Date(Date.now() - 60_000) })],
      nextPageToken: "",
    }));

    await screen.findByText("Late");
    expect(within(rowOf("Late")).getByText("Expired")).toBeTruthy();
  });
});

describe("InvitationManager revoke dialog", () => {
  async function revokeLineFor(redemptionCount: number): Promise<string> {
    renderManager(async () => ({
      entries: [link("inv_eng", "Engineering team invite", { role: IamRole.member, maxRedemptions: 0, redemptionCount })],
      nextPageToken: "",
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Engineering team invite" }));
    const text = screen.getByRole("dialog").textContent ?? "";
    cleanup();
    return text;
  }

  it("counts the people who joined, as a word, and names the organization they stay in", async () => {
    expect(await revokeLineFor(3)).toContain(
      "The link stops working at once. The three people who joined with it stay in acme.",
    );
  });

  it("says one person in the singular", async () => {
    expect(await revokeLineFor(1)).toContain(
      "The link stops working at once. The one person who joined with it stays in acme.",
    );
  });

  it("writes a count above ten in digits", async () => {
    expect(await revokeLineFor(14)).toContain("The 14 people who joined with it stay in acme.");
  });

  it("says no one has joined yet when the link was never used", async () => {
    expect(await revokeLineFor(0)).toContain("The link stops working at once. No one has joined with it yet.");
  });
});

describe("InvitationManager list that failed to load", () => {
  it("still offers New invite link above the error, and makes a link from it", async () => {
    const made = link("inv_new", "Launch week", { role: IamRole.member, maxRedemptions: 0, redemptionCount: 0 });
    const createInvitation = vi.fn(async () => made);
    renderManager(
      async () => {
        throw new Error("the server did not answer in time");
      },
      { create: createInvitation },
    );

    expect(await screen.findByText("Couldn't load the invite links.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New invite link" }));
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));

    expect(await screen.findByText(/Launch week/)).toBeTruthy();
    expect(createInvitation).toHaveBeenCalledTimes(1);
  });
});
