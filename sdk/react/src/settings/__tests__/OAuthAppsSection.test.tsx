/**
 * Pins what OAuthAppsSection offers a caller by the server's verdicts.
 * OAuth apps are administrative: an app carries its organization's vendor
 * credentials, the model shows it to its creator and the organization's
 * admins only, and the list holds only the apps the caller may view
 * (stigmer/stigmer#1257), so the section must neither offer what the server
 * refuses nor call an empty list "nothing configured" to someone who simply
 * may not see it.
 *
 *   - the list asks for the active organization's apps by its slug;
 *   - "New OAuth app" is offered only with `can_create_oauth_app` on the
 *     organization, checked on the organization's id;
 *   - an empty list reads "No OAuth apps configured yet." to a caller who
 *     may create one, and names the organization's admins to a caller the
 *     server has refused.
 *
 * The data hook and the permission check are stubbed; the list panel is
 * real. The detail panel's Edit and Delete gates are pinned beside it
 * (oauth-app/__tests__/OAuthAppDetailPanel.test.tsx).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  OAuthAppSchema,
  type OAuthApp,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { DeploymentMode } from "@stigmer/sdk";
import { DeploymentModeContext } from "../../deployment-mode";

const stubs = vi.hoisted(() => ({
  listedOrg: undefined as string | null | undefined,
  apps: [] as OAuthApp[],
  allowed: new Set<string>(),
  checked: [] as Array<[string, string, string]>,
}));

vi.mock("../../organization/OrgProvider.js", () => ({
  useActiveOrgSlug: () => "acme",
  useActiveOrgId: () => "org_acme",
}));
vi.mock("../../oauth-app/useOAuthAppList.js", () => ({
  useOAuthAppList: (org: string | null) => {
    stubs.listedOrg = org;
    return {
      oauthApps: stubs.apps,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    };
  },
}));
vi.mock("../../iam-policy/useCheckPermission.js", () => ({
  useCheckPermission: (
    resource: { kind: string; id: string } | null,
    relation: string,
  ) => {
    if (resource !== null) {
      stubs.checked.push([resource.kind, resource.id, relation]);
    }
    return {
      allowed: resource === null ? true : stubs.allowed.has(relation),
      isLoading: false,
      error: null,
    };
  },
}));

import { OAuthAppsSection } from "../OAuthAppsSection";

const SLACK = create(OAuthAppSchema, {
  metadata: {
    id: "oapp_slack",
    name: "Slack OAuth",
    slug: "slack-oauth",
    org: "acme",
  },
  spec: { provider: "slack", clientId: "slack-client-1" },
});

function renderSection(mode: DeploymentMode = "cloud") {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <OAuthAppsSection />
    </DeploymentModeContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  stubs.listedOrg = undefined;
  stubs.apps = [];
  stubs.allowed = new Set();
  stubs.checked = [];
});

describe("OAuthAppsSection", () => {
  it("lists the active organization's apps the caller may view", () => {
    stubs.apps = [SLACK];
    renderSection();
    expect(stubs.listedOrg).toBe("acme");
    expect(screen.getByText("slack-client-1")).toBeTruthy();
  });

  it("offers New OAuth app only with can_create_oauth_app on the organization", () => {
    renderSection();
    expect(screen.queryByRole("button", { name: /New OAuth app/ })).toBeNull();
    expect(stubs.checked).toContainEqual([
      "organization",
      "org_acme",
      "can_create_oauth_app",
    ]);

    cleanup();
    stubs.allowed = new Set(["can_create_oauth_app"]);
    renderSection();
    expect(screen.getByRole("button", { name: /New OAuth app/ })).toBeTruthy();
  });

  it("names the organization's admins, not an empty configuration, to a caller who may not create OAuth apps", () => {
    renderSection();
    expect(
      screen.getByText("OAuth apps are managed by your organization's admins."),
    ).toBeTruthy();
    expect(screen.queryByText("No OAuth apps configured yet.")).toBeNull();

    cleanup();
    stubs.allowed = new Set(["can_create_oauth_app"]);
    renderSection();
    expect(screen.getByText("No OAuth apps configured yet.")).toBeTruthy();
  });
});
