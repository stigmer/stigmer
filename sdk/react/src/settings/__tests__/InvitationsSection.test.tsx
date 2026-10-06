/**
 * Pins InvitationsSection's edition posture and its admin gate. An
 * organization's invitations are administered by its admins: the server
 * lists them to, and creates them for, callers who hold `can_grant_access`
 * on the organization. So the section offers the manager to those callers
 * only and names the admins to everyone else, instead of an empty list and
 * a create button the server refuses.
 *
 *   - where the edition does not serve invitations (open source) the
 *     section says so and asks the server nothing;
 *   - the check is `can_grant_access` on the organization's id;
 *   - a refused caller reads who manages invitations, is offered nothing,
 *     and the server never receives a list request for them;
 *   - an allowed caller gets the manager, which lists once, a page at a
 *     time: the first page, then "Load more" continues from the page's
 *     token until the server says the list is complete; a link revoked
 *     from a later page reads as revoked, though the refetch after it
 *     re-reads only the first page; a failed "Load more" says so and
 *     offers the button again; the active count shows once every page is
 *     loaded, never an undercount;
 *   - while the check is in flight neither answer shows;
 *   - a failed check leaves the manager in place (fail-open: the server
 *     re-checks every call, and an admin is never told they are not one).
 *
 * Everything below the network is real — the organization provider, the
 * permission hook and gate, the manager and its list hook — over a router
 * transport that records what the server was asked.
 */
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer, type DeploymentMode } from "@stigmer/sdk";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  CheckAuthorizationResultSchema,
  type CheckMyPermissionInput,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import {
  InvitationSchema,
  InvitationStatusSchema,
} from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import { InvitationsSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import { InvitationSpecSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/spec_pb";
import { InvitationQueryController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/query_pb";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { OrgProvider } from "../../organization/OrgProvider";
import { InvitationsSection } from "../InvitationsSection";

const MANAGED_BY_ADMINS = "Invitations are managed by your organization's admins.";

/** The organization's id and slug differ, so the test sees which one each call carries. */
const ACME = create(OrganizationSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "org_acme", slug: "acme", name: "Acme" }),
});

/** What the fake server answers, and what it was asked. */
interface Server {
  readonly verdict: () => Promise<boolean>;
  readonly orgs: readonly Organization[];
  readonly checks: CheckMyPermissionInput[];
  readonly listedOrgs: string[];
  /** Each list request's page size and token, in order. */
  readonly listedPages: Array<{ pageSize: number; pageToken: string }>;
  /** The labels each page token answers, and the token after it; one empty page when absent. */
  readonly pages?: Readonly<Record<string, { labels: readonly string[]; next: string }>>;
  /** Page tokens whose read fails, until the case clears one. */
  readonly failing: Set<string>;
}

function newServer(
  verdict: () => Promise<boolean>,
  orgs: readonly Organization[] = [ACME],
  pages?: Server["pages"],
): Server {
  return {
    verdict,
    orgs,
    checks: [],
    listedOrgs: [],
    listedPages: [],
    failing: new Set(),
    ...(pages === undefined ? {} : { pages }),
  };
}

/** An active invitation as the list answers one, identified and labelled by `label`. */
function invitation(label: string, state = InvitationState.active) {
  return create(InvitationSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `inv_${label}`, name: label, org: "org_acme" }),
    spec: create(InvitationSpecSchema, { label }),
    status: create(InvitationStatusSchema, { state }),
  });
}

const never = () => new Promise<boolean>(() => {});

/**
 * Answers after a macrotask, as a real network does: the gate renders its
 * in-flight state before the verdict lands. An answer that lands within
 * the same flush would hide a gate that mounts its content early.
 */
const answerLater = (verdict: boolean) => () =>
  new Promise<boolean>((resolve) => setTimeout(() => resolve(verdict), 0));

function renderSection(mode: DeploymentMode, server: Server) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport((router) => {
      router.service(OrganizationQueryController, {
        findMyOrganizations: () => create(OrganizationsSchema, { entries: [...server.orgs] }),
      });
      router.service(IamPolicyQueryController, {
        checkMyPermission: async (input) => {
          server.checks.push(input);
          return create(CheckAuthorizationResultSchema, {
            isAuthorized: await server.verdict(),
          });
        },
      });
      router.service(InvitationCommandController, {
        revoke: (input) => invitation(input.value.replace(/^inv_/, ""), InvitationState.revoked),
      });
      router.service(InvitationQueryController, {
        listByOrg: (input) => {
          server.listedOrgs.push(input.org);
          server.listedPages.push({ pageSize: input.pageSize, pageToken: input.pageToken });
          if (server.failing.has(input.pageToken)) {
            throw new ConnectError("invitations unavailable", Code.Unavailable);
          }
          const page = server.pages?.[input.pageToken];
          return create(InvitationsSchema, {
            entries: (page?.labels ?? []).map((label) => invitation(label)),
            nextPageToken: page?.next ?? "",
          });
        },
      });
    }),
  });
  return render(
    <StigmerContext.Provider value={client}>
      <DeploymentModeContext.Provider value={mode}>
        <OrgProvider>
          <InvitationsSection />
        </OrgProvider>
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>,
  );
}

/** Lets every pending transport call and state update land. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("InvitationsSection", () => {
  it("says invitations are not served on the open-source edition and asks the server nothing", async () => {
    const server = newServer(async () => true);
    renderSection("local", server);

    expect(await screen.findByText(/Invitations are not available in local mode/)).toBeTruthy();
    await settle();
    expect(server.checks).toEqual([]);
    expect(server.listedOrgs).toEqual([]);
  });

  it("asks for an organization, and checks nothing, when none is selected", async () => {
    const server = newServer(async () => true, []);
    renderSection("cloud", server);
    await settle();

    expect(screen.getByText("Select an organization to manage invitations.")).toBeTruthy();
    expect(server.checks).toEqual([]);
  });

  it("checks can_grant_access on the organization's id", async () => {
    const server = newServer(async () => true);
    renderSection("cloud", server);

    await waitFor(() => expect(server.checks).toHaveLength(1));
    const [check] = server.checks;
    expect(check?.resource?.kind).toBe("organization");
    expect(check?.resource?.id).toBe("org_acme");
    expect(check?.relation).toBe("can_grant_access");
  });

  it("names the organization's admins to a refused caller, offers nothing, and never lists", async () => {
    const server = newServer(answerLater(false));
    renderSection("cloud", server);

    expect(await screen.findByText(MANAGED_BY_ADMINS)).toBeTruthy();
    await settle();
    expect(screen.queryByRole("button", { name: /Create invite link/ })).toBeNull();
    expect(server.listedOrgs).toEqual([]);
  });

  it("gives an allowed caller the manager, which lists the organization once", async () => {
    const server = newServer(answerLater(true));
    renderSection("enterprise", server);

    expect(await screen.findByRole("button", { name: /Create invite link/ })).toBeTruthy();
    await settle();
    expect(server.listedOrgs).toEqual(["org_acme"]);
    expect(screen.queryByText(MANAGED_BY_ADMINS)).toBeNull();
  });

  it("pages the invitations, newest first, with Load more until the server says the list is complete", async () => {
    const server = newServer(answerLater(true), [ACME], {
      "": { labels: ["Newest", "Newer"], next: "after-newer" },
      "after-newer": { labels: ["Oldest"], next: "" },
    });
    renderSection("cloud", server);

    expect(await screen.findByText("Newest")).toBeTruthy();
    expect(screen.getByText("Newer")).toBeTruthy();
    expect(screen.queryByText("Oldest")).toBeNull();
    expect(server.listedPages).toEqual([{ pageSize: 25, pageToken: "" }]);
    expect(screen.queryByText(/active$/)).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(await screen.findByText("Oldest")).toBeTruthy();
    expect(server.listedPages).toEqual([
      { pageSize: 25, pageToken: "" },
      { pageSize: 25, pageToken: "after-newer" },
    ]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(screen.getByText("3 active")).toBeTruthy();
  });

  it("says a failed Load more failed and offers it again", async () => {
    const server = newServer(answerLater(true), [ACME], {
      "": { labels: ["Newest"], next: "after-newest" },
      "after-newest": { labels: ["Oldest"], next: "" },
    });
    server.failing.add("after-newest");
    renderSection("cloud", server);

    expect(await screen.findByText("Newest")).toBeTruthy();
    await act(async () => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    await settle();

    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(screen.queryByText("Oldest")).toBeNull();
    server.failing.delete("after-newest");
    await act(async () => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(await screen.findByText("Oldest")).toBeTruthy();
  });

  it("shows a link revoked from a later page as revoked, though the refetch re-reads only the first page", async () => {
    const server = newServer(answerLater(true), [ACME], {
      "": { labels: ["Newest"], next: "after-newest" },
      "after-newest": { labels: ["Oldest"], next: "" },
    });
    renderSection("cloud", server);

    expect(await screen.findByText("Newest")).toBeTruthy();
    await act(async () => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(await screen.findByText("Oldest")).toBeTruthy();
    expect(screen.getByText("2 active")).toBeTruthy();
    // Before the last page arrived the count was withheld (see the Load more case).

    await act(async () => {
      screen.getByRole("button", { name: "Revoke Oldest" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Revoke" }).click();
    });
    await settle();

    expect(server.listedPages.at(-1)).toEqual({ pageSize: 25, pageToken: "" });
    expect(screen.queryByRole("button", { name: "Revoke Oldest" })).toBeNull();
    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
  });

  it("shows neither answer while the check is in flight", async () => {
    const server = newServer(never);
    renderSection("cloud", server);

    await waitFor(() => expect(server.checks).toHaveLength(1));
    await settle();
    expect(screen.queryByText(MANAGED_BY_ADMINS)).toBeNull();
    expect(screen.queryByRole("button", { name: /Create invite link/ })).toBeNull();
    expect(server.listedOrgs).toEqual([]);
  });

  it("keeps the manager when the check itself fails", async () => {
    const server = newServer(async () => {
      throw new ConnectError("authorization unavailable", Code.Unavailable);
    });
    renderSection("cloud", server);

    expect(await screen.findByRole("button", { name: /Create invite link/ })).toBeTruthy();
    expect(screen.queryByText(MANAGED_BY_ADMINS)).toBeNull();
  });
});
