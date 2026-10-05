/**
 * ChildOrganizationsList: a parent organization's admins see its children
 * (name, slug, external id), newest first, page by page through
 * listChildOrgs; nobody else sees the section, which is never asked for
 * until `can_manage_child_orgs` is confirmed, and a server that holds one
 * organization never shows it. An organization with no children shows
 * nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { CheckMyPermissionInput } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { ListChildOrgsInput } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { ChildOrganizationsList } from "../ChildOrganizationsList";

const PARENT = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

function child(id: string, name: string, slug: string, externalId: string): Organization {
  return create(OrganizationSchema, {
    metadata: { id, name, slug },
    spec: { parentOrg: PARENT, externalId },
  });
}

const ACME = child("org_01jbbbbbbbbbbbbbbbbbbbbbbb", "Acme Corp", "acme", "cust-4411");
const BETA = child("org_01jcccccccccccccccccccccccc", "Beta Ltd", "beta", "cust-4412");

function clientWith(options: {
  manages: boolean;
  singleOrg?: boolean;
  pages?: ReadonlyArray<{ entries: Organization[]; nextPageToken: string }>;
}) {
  const pages = options.pages ?? [{ entries: [ACME], nextPageToken: "" }];
  const listChildOrgs = vi.fn(async (input: ListChildOrgsInput) => {
    const index = input.pageToken === "" ? 0 : Number(input.pageToken);
    return pages[index] ?? { entries: [], nextPageToken: "" };
  });
  const checkMyPermission = vi.fn(async (input: CheckMyPermissionInput) => ({
    isAuthorized: input.relation === "can_manage_child_orgs" ? options.manages : false,
  }));
  return {
    listChildOrgs,
    checkMyPermission,
    client: {
      organization: { listChildOrgs },
      iamPolicy: { checkMyPermission },
      platform: {
        getServerInfo: vi.fn(async () => ({ singleOrg: options.singleOrg ?? false })),
      },
    },
  };
}

function renderList(client: unknown) {
  return render(
    <StigmerContext.Provider value={client as never}>
      <DeploymentModeContext.Provider value="cloud">
        <ChildOrganizationsList org={PARENT} />
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("ChildOrganizationsList", () => {
  it("lists a parent's children with their name, slug and external id", async () => {
    const { client, listChildOrgs } = clientWith({ manages: true });
    renderList(client);
    expect(await screen.findByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("acme")).toBeTruthy();
    expect(screen.getByText("cust-4411")).toBeTruthy();
    expect(listChildOrgs.mock.calls[0]?.[0]).toMatchObject({ org: PARENT, pageToken: "" });
  });

  it("loads the next page while the server holds more", async () => {
    const { client } = clientWith({
      manages: true,
      pages: [
        { entries: [ACME], nextPageToken: "1" },
        { entries: [BETA], nextPageToken: "" },
      ],
    });
    renderList(client);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Beta Ltd")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("is never asked for, and shows nothing, for a caller who may not manage children", async () => {
    const { client, listChildOrgs, checkMyPermission } = clientWith({ manages: false });
    const { container } = renderList(client);
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());
    expect(listChildOrgs).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("shows nothing on a server that holds one organization", async () => {
    const { client, listChildOrgs, checkMyPermission } = clientWith({
      manages: true,
      singleOrg: true,
    });
    const { container } = renderList(client);
    await waitFor(() => expect(client.platform.getServerInfo).toHaveBeenCalled());
    expect(checkMyPermission).not.toHaveBeenCalled();
    expect(listChildOrgs).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("shows nothing for an organization with no children", async () => {
    const { client, listChildOrgs } = clientWith({
      manages: true,
      pages: [{ entries: [], nextPageToken: "" }],
    });
    const { container } = renderList(client);
    await waitFor(() => expect(listChildOrgs).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
