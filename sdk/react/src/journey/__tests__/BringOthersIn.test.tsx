/**
 * Pins the journey's last page, over a client answering as the server would:
 *
 *   - naming: on a server of many organizations, a name that still equals
 *     the address (a sign-up that named it from an email) asks for the
 *     company's name, saves it as the profile page does, and offers "Keep";
 *     a named organization is one quiet line with Rename; the address is
 *     only ever shown, with its reason; a person who may not edit is told
 *     who can; a server of one organization has no naming part at all;
 *   - inviting: an admin picks Member (the default) or Admin, in plain
 *     words, and makes one link of many uses for 7 days, labelled for the
 *     journey, shown with Copy through the host's URL builder; a link still
 *     live is shown again on return, and Revoke takes it away; a viewer who
 *     may not grant access is told only an admin can; where invitations are
 *     not served, people join by signing in at the console's address;
 *   - who's here: the people of the team (app users and service accounts
 *     left out), the viewer marked "You"; once someone else is here the
 *     journey is done, and the next line is the edition's: an organization
 *     per customer (with the plan that unlocks them on a Cloud plan that
 *     lacks them), or a vault per customer on one organization;
 *   - a host that knows no address an invitee can open (a desktop app on a
 *     server whose web console it does not know) makes no link and says
 *     where to make one, and names no sign-in address it does not know;
 *   - a failed read of the organization says so, with Try again;
 *   - a server that trusts every caller: one note on why nobody else can
 *     reach it, and no read of invitations or of the access list.
 *
 * The plan reads are stubbed (their own suites pin them).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { DeploymentMode, InvitationInput } from "@stigmer/client";
import { DeploymentModeContext } from "@stigmer/react-core";
import { InvitationSchema, type Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { BringOthersIn, BRING_OTHERS_IN_LINK_LABEL, type BringOthersInProps } from "../BringOthersIn";

const stubs = vi.hoisted(() => ({ planAllowsChildren: null as boolean | null, journeyDone: true }));
// The headline reads the journey's own answer, which its suite pins.
vi.mock("../useJourney.js", () => ({
  useJourney: () =>
    stubs.journeyDone
      ? { status: "ready", steps: [], done: 6, current: undefined, agent: undefined, everRan: true }
      : { status: "ready", steps: [], done: 5, current: { id: "make-yours" }, agent: undefined, everRan: true },
}));
vi.mock("../../billing/useEntitlements.js", () => ({
  useEntitlements: (_org: string | null, options?: { enabled?: boolean }) => ({
    entitlements: null,
    allows: () => (options?.enabled === false ? null : stubs.planAllowsChildren),
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("../../billing/usePlans.js", async () => {
  const { BUSINESS, TEAM } = await import("../../billing/__tests__/fixtures");
  return {
    usePlans: (options?: { enabled?: boolean }) => ({
      plans: options?.enabled === false ? null : [BUSINESS, TEAM],
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    }),
  };
});

const PERSON = IdentityAccountProvisioningMode.direct;
const APP_USER = IdentityAccountProvisioningMode.app_user;
const SERVICE_ACCOUNT = IdentityAccountProvisioningMode.service_account;
const DAY_MS = 86_400_000;

interface World {
  name: string;
  singleOrg: boolean;
  signsIn: boolean;
  allowed: Set<string>;
  invitations: Invitation[];
  people: { id: string; name: string; mode: IdentityAccountProvisioningMode; role?: string }[];
  /** whoAmI never answers. */
  meUnknown: boolean;
  /** The organization's read fails. */
  orgReadFails: boolean;
}

let world: World;

beforeEach(() => {
  world = {
    name: "acme",
    singleOrg: false,
    signsIn: true,
    allowed: new Set(["can_edit", "can_grant_access", "can_view_access"]),
    invitations: [],
    people: [{ id: "ida_dana", name: "Dana Lee", mode: PERSON, role: "owner" }],
    meUnknown: false,
    orgReadFails: false,
  };
  stubs.planAllowsChildren = null;
  stubs.journeyDone = true;
  localStorage.clear();
});
afterEach(cleanup);

function invitation(fields: { id: string; token: string; label?: string; role?: IamRole; state?: InvitationState; expiresInMs?: number }): Invitation {
  return create(InvitationSchema, {
    metadata: { id: fields.id, org: ACME_ID },
    spec: {
      role: fields.role ?? IamRole.member,
      label: fields.label ?? BRING_OTHERS_IN_LINK_LABEL,
      expiresAt: timestampFromDate(new Date(Date.now() + (fields.expiresInMs ?? 7 * DAY_MS))),
    },
    status: { token: fields.token, state: fields.state ?? InvitationState.active },
  });
}

function renderPage(mode: DeploymentMode = "cloud", props: Partial<BringOthersInProps> = {}) {
  const org = (): Organization => ({ metadata: { id: ACME_ID, slug: "acme", name: world.name, etag: "1" } }) as Organization;
  const client = {
    platform: { getServerInfo: vi.fn(async () => ({ singleOrg: world.singleOrg, authenticationRequired: world.signsIn })) },
    grant: {
      checkMyPermission: vi.fn(async (input: { relation: string }) => ({ isAuthorized: world.allowed.has(input.relation) })),
      listResourceAccessByPrincipal: vi.fn(async () => ({
        entries: world.people.map((person) => ({
          principal: { kind: "identity_account", id: person.id, name: person.name, email: "", identityOrigin: { provisioningMode: person.mode } },
          roles: person.role ? [{ role: { code: person.role }, isInherited: false }] : [],
        })),
      })),
    },
    identityAccount: {
      whoAmI: vi.fn(() => (world.meUnknown ? new Promise<never>(() => {}) : Promise.resolve({ metadata: { id: "ida_dana" } }))),
    },
    organization: {
      get: vi.fn(async () => {
        if (world.orgReadFails) throw new Error("unavailable");
        return org();
      }),
      update: vi.fn(async (resource: Organization) => {
        world.name = resource.metadata?.name ?? world.name;
        return org();
      }),
    },
    invitation: {
      list: vi.fn(async () => ({ entries: world.invitations, nextPageToken: "" })),
      create: vi.fn(async (input: InvitationInput) => {
        const made = invitation({ id: "inv_new", token: "tok-new", role: input.role });
        world.invitations = [made, ...world.invitations];
        return made;
      }),
      revoke: vi.fn(async (id: string) => {
        world.invitations = world.invitations.map((entry) =>
          entry.metadata?.id === id ? invitation({ id, token: entry.status?.token ?? "", state: InvitationState.revoked }) : entry,
        );
        return world.invitations.find((entry) => entry.metadata?.id === id);
      }),
    },
  };
  const Orgs = orgWrapper(client, [org()], true);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DeploymentModeContext.Provider value={mode}>
      <Orgs>{children}</Orgs>
    </DeploymentModeContext.Provider>
  );
  render(
    <BringOthersIn
      buildInviteUrl={(token) => `https://console.test/invite/${token}`}
      consoleUrl="https://console.test"
      membersHref="/settings/members"
      {...props}
    />,
    { wrapper },
  );
  return client;
}

describe("CON-12 BringOthersIn — naming the organization", () => {
  it("asks for the company's name while the name is still the address, and saves only the name", async () => {
    const client = renderPage();

    await screen.findByText("Stigmer named it from your email when you signed up. Give it your company’s name before you invite anyone.");
    expect(screen.getByText("acme", { selector: "span" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ledgerly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.organization.update).toHaveBeenCalledTimes(1));
    const [resource, paths] = client.organization.update.mock.calls[0] as unknown as [Organization, string[]];
    expect(resource.metadata?.name).toBe("Ledgerly");
    expect(paths).toEqual(["metadata.name"]);
    await screen.findByRole("region", { name: "Your organization" });
    expect(screen.getByText(/stays as it is: your app’s code uses it/)).toBeTruthy();
  });

  it("keeps a name its person chose, and asks no more", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Keep acme" }));
    await screen.findByRole("region", { name: "Your organization" });
    expect(screen.queryByText(/Stigmer named it from your email/)).toBeNull();
  });

  it("asks again, and still keeps the name for now, where the browser's storage is unavailable", async () => {
    const unavailable = () => {
      throw new Error("storage unavailable");
    };
    vi.stubGlobal("localStorage", { getItem: unavailable, setItem: unavailable, removeItem: unavailable, clear: () => {} });
    try {
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Keep acme" }));
      await screen.findByRole("region", { name: "Your organization" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("saves nothing for an empty name", async () => {
    const client = renderPage();
    const field = await screen.findByLabelText("Name");
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.organization.update).not.toHaveBeenCalled();
  });

  it("shows a named organization as one line with Rename, and Cancel puts it back", async () => {
    world.name = "Ledgerly";
    renderPage();
    await screen.findByRole("region", { name: "Your organization" });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ledgerly");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Rename" });
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("says a failed read in place of loading for ever, with Try again", async () => {
    world.orgReadFails = true;
    const client = renderPage();
    await screen.findByText("Couldn’t load your organization’s name.");
    world.orgReadFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Name");
    expect(client.organization.get.mock.calls.length).toBeGreaterThan(1);
  });

  it("tells a person who may not edit it who can", async () => {
    world.allowed.delete("can_edit");
    renderPage();
    await screen.findByText(/Only organization admins can rename it\./);
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("has no naming part on a server of one organization", async () => {
    world.singleOrg = true;
    renderPage();
    await screen.findByRole("region", { name: "Invite your team" });
    expect(screen.queryByRole("region", { name: "Name your organization" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Your organization" })).toBeNull();
  });
});

describe("CON-12 BringOthersIn — inviting the team", () => {
  it("makes one link of many uses for a week, Member by default, and shows it with Copy", async () => {
    world.name = "Ledgerly";
    const client = renderPage();

    expect(((await screen.findByRole("radio", { name: "Member" })) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Members use your agents. Admins can also change them and add keys.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make an invite link" }));

    await screen.findByText("https://console.test/invite/tok-new");
    const sent = client.invitation.create.mock.calls[0]?.[0] as InvitationInput;
    expect(sent.role).toBe(IamRole.member);
    expect(sent.maxRedemptions).toBe(0);
    expect(sent.label).toBe(BRING_OTHERS_IN_LINK_LABEL);
    const days = (new Date(sent.expiresAt).getTime() - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect(screen.getByText(/Anyone with it can join as a Member until/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the invite link" })).toBeTruthy();
  });

  it("builds the link on the console's own address when the host names no builder, and Copy copies it", async () => {
    world.name = "Ledgerly";
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage("cloud", { buildInviteUrl: undefined });

    fireEvent.click(await screen.findByRole("button", { name: "Make an invite link" }));
    const url = `${window.location.origin}/invite/tok-new`;
    await screen.findByText(url);
    fireEvent.click(screen.getByRole("button", { name: "Copy the invite link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    await screen.findByText("Copied");
  });

  it("makes an Admin link when Admin is picked", async () => {
    world.name = "Ledgerly";
    const client = renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: "Admin" }));
    fireEvent.click(screen.getByRole("button", { name: "Make an invite link" }));
    await screen.findByText(/Anyone with it can join as an Admin/);
    expect((client.invitation.create.mock.calls[0]?.[0] as InvitationInput).role).toBe(IamRole.admin);
  });

  it("shows a live link again on return, ignoring other links, and Revoke takes it away", async () => {
    world.name = "Ledgerly";
    world.invitations = [
      invitation({ id: "inv_other", token: "tok-other", label: "for the auditors" }),
      invitation({ id: "inv_live", token: "tok-live" }),
    ];
    const client = renderPage();

    await screen.findByText("https://console.test/invite/tok-live");
    fireEvent.click(screen.getByRole("button", { name: "Revoke this link" }));
    await screen.findByRole("button", { name: "Make an invite link" });
    expect(client.invitation.revoke).toHaveBeenCalledWith("inv_live");
  });

  it("says a link that wasn't made, and keeps Make an invite link to try again", async () => {
    world.name = "Ledgerly";
    const client = renderPage();
    client.invitation.create.mockRejectedValueOnce(new Error("the invitation store is down"));
    fireEvent.click(await screen.findByRole("button", { name: "Make an invite link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn’t make the link. Try again.");
    expect(screen.getByRole("button", { name: "Make an invite link" })).toBeTruthy();
  });

  it("says a link that wasn't revoked, and keeps it shown", async () => {
    world.name = "Ledgerly";
    world.invitations = [invitation({ id: "inv_live", token: "tok-live" })];
    const client = renderPage();
    client.invitation.revoke.mockRejectedValueOnce(new Error("the invitation store is down"));
    await screen.findByText("https://console.test/invite/tok-live");
    fireEvent.click(screen.getByRole("button", { name: "Revoke this link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn’t revoke the link. Try again.");
    expect(screen.getByText("https://console.test/invite/tok-live")).toBeTruthy();
  });

  it("never shows a revoked or expired journey link as live", async () => {
    world.name = "Ledgerly";
    world.invitations = [
      invitation({ id: "inv_gone", token: "tok-gone", state: InvitationState.revoked }),
      invitation({ id: "inv_old", token: "tok-old", expiresInMs: -DAY_MS }),
    ];
    renderPage();
    await screen.findByRole("button", { name: "Make an invite link" });
    expect(screen.queryByText(/tok-gone|tok-old/)).toBeNull();
  });

  it("makes no link where the host knows no address an invitee can open, and says where to make one", async () => {
    world.name = "Ledgerly";
    const client = renderPage("cloud", { buildInviteUrl: null });
    await screen.findByText("This app doesn't know your server's web console. Open it in a browser to make an invite link there.");
    expect(screen.queryByRole("button", { name: "Make an invite link" })).toBeNull();
    expect(client.invitation.list).not.toHaveBeenCalled();
  });

  it("names no sign-in address the host does not know", async () => {
    world.singleOrg = true;
    renderPage("local", { consoleUrl: null });
    await screen.findByText(/People join by signing in to your server’s web console/);
    expect(screen.queryByRole("button", { name: "Copy the address" })).toBeNull();
  });

  it("tells a viewer who may not grant access that only an admin can invite", async () => {
    world.allowed.delete("can_grant_access");
    const client = renderPage();
    await screen.findByText("Only an admin can invite people.");
    expect(client.invitation.list).not.toHaveBeenCalled();
  });

  it("where invitations are not served, people join by signing in at the console's address", async () => {
    world.singleOrg = true;
    const client = renderPage("local");
    await screen.findByText(/People join by signing in at this console’s address/);
    expect(screen.getByText("https://console.test")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Members" }).getAttribute("href")).toBe("/settings/members");
    expect(client.invitation.list).not.toHaveBeenCalled();
  });
});

describe("CON-12 BringOthersIn — who's here", () => {
  it("lists the team's people with their roles, the viewer marked, app users and service accounts left out", async () => {
    world.name = "Ledgerly";
    world.people.push(
      { id: "ida_customer", name: "A customer", mode: APP_USER },
      { id: "ida_backend", name: "app-backend", mode: SERVICE_ACCOUNT, role: "admin" },
    );
    renderPage();

    const list = await screen.findByRole("list", { name: "People in this organization" });
    expect(list.textContent).toContain("Dana Lee");
    expect(list.textContent).toContain("You");
    expect(list.textContent).toContain("Owner");
    expect(list.textContent).not.toContain("A customer");
    expect(list.textContent).not.toContain("app-backend");
    expect(screen.getByText("Nobody else yet. They appear here once they join.")).toBeTruthy();
  });

  it("once someone else joins, says the journey is done and points at an organization per customer", async () => {
    world.name = "Ledgerly";
    world.people.push({ id: "ida_sam", name: "Sam Ortiz", mode: PERSON, role: "member" });
    renderPage();

    await screen.findByText("All six steps done.");
    expect(screen.getByText("Sam Ortiz")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Give each customer an organization of their own" }).getAttribute("href")).toBe(
      "https://stigmer.ai/docs/getting-started/one-organization-per-customer",
    );
    expect(screen.queryByText(/need the Business plan/)).toBeNull();
  });

  it("says only that the team is here while the journey's earlier steps are open", async () => {
    world.name = "Ledgerly";
    world.people.push({ id: "ida_sam", name: "Sam", mode: PERSON, role: "member" });
    stubs.journeyDone = false;
    renderPage();
    await screen.findByText("Your team is here.");
    expect(screen.queryByText("All six steps done.")).toBeNull();
  });

  it("leaves out who's here for a viewer who may not read the access list", async () => {
    world.name = "Ledgerly";
    world.allowed.delete("can_view_access");
    renderPage();
    await screen.findByRole("region", { name: "Invite your team" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("region", { name: "Who's here" })).toBeNull();
  });

  it("counts nobody as joined until the viewer is known", async () => {
    world.name = "Ledgerly";
    world.people.push({ id: "ida_sam", name: "Sam", mode: PERSON, role: "member" });
    world.meUnknown = true;
    renderPage();
    await screen.findByRole("list", { name: "People in this organization" });
    expect(screen.queryByText(/All six steps done|Your team is here/)).toBeNull();
  });

  it("on a Cloud plan without child organizations, names the plan that has them", async () => {
    world.name = "Ledgerly";
    world.people.push({ id: "ida_sam", name: "Sam", mode: PERSON, role: "member" });
    stubs.planAllowsChildren = false;
    renderPage();
    await screen.findByText("All six steps done.");
    expect(await screen.findByText(/Business plan/)).toBeTruthy();
  });

  it("on a server of one organization, points at a vault per customer", async () => {
    world.singleOrg = true;
    world.people.push({ id: "ida_sam", name: "Sam", mode: PERSON, role: "member" });
    renderPage("local");
    await screen.findByText("All six steps done.");
    expect(screen.getByRole("link", { name: "Give each one a vault of their own" }).getAttribute("href")).toBe(
      "https://stigmer.ai/docs/guides/authentication/customer-keys",
    );
  });
});

describe("CON-12 BringOthersIn — a server that trusts every caller", () => {
  it("says nobody else can reach it, and reads neither invitations nor the access list", async () => {
    world.signsIn = false;
    world.singleOrg = true;
    const client = renderPage("local");
    await screen.findByText("This Stigmer is on your computer, so only you can reach it.");
    expect(screen.getByRole("link", { name: "a server with sign-in turned on" })).toBeTruthy();
    expect(client.invitation.list).not.toHaveBeenCalled();
    expect(client.grant.listResourceAccessByPrincipal).not.toHaveBeenCalled();
  });
});
