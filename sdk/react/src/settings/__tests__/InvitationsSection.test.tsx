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
 *   - an allowed caller gets the manager, which lists once;
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
import { InvitationsSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
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
}

function newServer(
  verdict: () => Promise<boolean>,
  orgs: readonly Organization[] = [ACME],
): Server {
  return { verdict, orgs, checks: [], listedOrgs: [] };
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
      router.service(InvitationQueryController, {
        listByOrg: (input) => {
          server.listedOrgs.push(input.org);
          return create(InvitationsSchema, {});
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
    expect(server.listedOrgs).toEqual(["acme"]);
    expect(screen.queryByText(MANAGED_BY_ADMINS)).toBeNull();
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
