/**
 * Pins what ChannelAppsSection offers a caller by the server's verdicts.
 * A channel app carries its organization's Slack or Meta app secrets, the
 * model shows it to its creator, direct grants and the organization's
 * admins only, and the list holds only the apps the caller may view
 * (stigmer/stigmer#1384), so the section must neither offer what the server
 * refuses nor call an empty list "nothing registered" to someone who simply
 * may not see it.
 *
 *   - the list asks for the active organization's apps by its slug;
 *   - "New channel app" is offered only with `can_create_channel_app` on
 *     the organization, checked on the organization's id;
 *   - an empty list reads "No channel apps yet" to a caller who
 *     may create one, and names the organization's admins to a caller the
 *     server has refused;
 *   - in local mode the section asks nothing and shows the cloud notice.
 *
 * The data hook and the permission check are stubbed; the list panel is
 * real. The detail panel's credentials and delete gates are pinned beside
 * it (channel-app/__tests__/ChannelAppDetailPanel.test.tsx).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ChannelAppSchema,
  type ChannelApp,
} from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { DeploymentMode } from "@stigmer/client";
import { DeploymentModeContext, StigmerContext } from "@stigmer/react-core";

const stubs = vi.hoisted(() => ({
  listedOrg: undefined as string | null | undefined,
  apps: [] as ChannelApp[],
  allowed: new Set<string>(),
  checked: [] as Array<[string, string, string]>,
  checkError: null as Error | null,
  singleOrg: false as boolean | undefined,
}));

vi.mock("../../organization/OrgProvider.js", () => ({
  useActiveOrgId: () => "org_acme",
  useOptionalOrg: () => ({ activeOrg: { metadata: { id: "org_acme", slug: "acme" } } }),
}));
vi.mock("../../server-info.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server-info.js")>()),
  useSingleOrg: () => stubs.singleOrg,
}));
vi.mock("../../channel-app/useChannelAppList.js", () => ({
  useChannelAppList: (org: string | null) => {
    stubs.listedOrg = org;
    return {
      channelApps: stubs.apps,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    };
  },
}));
vi.mock("../../grant/useCheckPermission.js", () => ({
  useCheckPermission: (
    resource: { kind: string; id: string } | null,
    relation: string,
  ) => {
    if (resource !== null) {
      stubs.checked.push([resource.kind, resource.id, relation]);
    }
    return {
      allowed: stubs.checkError === null && (resource === null ? true : stubs.allowed.has(relation)),
      isLoading: false,
      error: stubs.checkError,
    };
  },
}));

import { ChannelAppsSection } from "../ChannelAppsSection";

const SLACK = create(ChannelAppSchema, {
  metadata: {
    id: "chapp_slack",
    name: "Acme Slack",
    slug: "acme-slack",
    org: "acme",
  },
  spec: {
    providerConfig: {
      case: "slack",
      value: { clientId: "1234.5678" },
    },
  },
});

function renderSection(mode: DeploymentMode = "cloud") {
  return render(
    <DeploymentModeContext.Provider value={mode}>
      <ChannelAppsSection />
    </DeploymentModeContext.Provider>,
  );
}

/** A client for the open detail, whose panel reads and checks through it. */
const CLIENT = {
  baseUrl: "https://api.stigmer.ai",
  grant: { checkMyPermission: async () => ({ isAuthorized: false }) },
} as never;

afterEach(() => {
  cleanup();
  stubs.listedOrg = undefined;
  stubs.apps = [];
  stubs.allowed = new Set();
  stubs.checkError = null;
  stubs.singleOrg = false;
  stubs.checked = [];
});

describe("ChannelAppsSection", () => {
  it("lists the active organization's apps the caller may view", () => {
    stubs.apps = [SLACK];
    renderSection();
    expect(stubs.listedOrg).toBe("org_acme");
    expect(screen.getByText("Acme Slack")).toBeTruthy();
  });

  it("offers New channel app only with can_create_channel_app on the organization", () => {
    renderSection();
    expect(
      screen.queryByRole("button", { name: /New channel app/ }),
    ).toBeNull();
    expect(stubs.checked).toContainEqual([
      "organization",
      "org_acme",
      "can_create_channel_app",
    ]);

    cleanup();
    stubs.allowed = new Set(["can_create_channel_app"]);
    renderSection();
    // The header offers it, and so does the empty list.
    expect(screen.getAllByRole("button", { name: /New channel app/ })).toHaveLength(2);
  });

  it("names the organization's admins, not an empty registry, to a caller who may not create channel apps", () => {
    renderSection();
    expect(
      screen.getByText(
        "Channel apps are managed by your organization's admins.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No channel apps yet")).toBeNull();

    cleanup();
    stubs.allowed = new Set(["can_create_channel_app"]);
    renderSection();
    expect(screen.getByText("No channel apps yet")).toBeTruthy();
  });

  it("asks nothing in local mode, where channel installs do not exist", () => {
    renderSection("local");
    expect(stubs.checked).toEqual([]);
    expect(
      screen.queryByRole("button", { name: /New channel app/ }),
    ).toBeNull();
    expect(
      screen.getByText(/Channel apps come with Stigmer Cloud/),
    ).toBeTruthy();
  });
  it("does not call a failed permission check a denial", () => {
    stubs.checkError = new Error("check timed out");
    renderSection();
    expect(
      screen.queryByText("Channel apps are managed by your organization's admins."),
    ).toBeNull();
    expect(screen.getByText("No channel apps yet")).toBeTruthy();
  });

  it("names the open app on the page, with a way back to the list", () => {
    stubs.apps = [SLACK];
    stubs.allowed = new Set(["can_edit"]);
    render(
      <StigmerContext.Provider value={CLIENT}>
        <DeploymentModeContext.Provider value={"cloud"}>
          <ChannelAppsSection />
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit Acme Slack/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Acme Slack" })).toBeTruthy();
    // The panel draws no second name under the page's title.
    expect(screen.queryByRole("heading", { level: 3, name: "Acme Slack" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Channel apps" }));
    expect(screen.getByRole("heading", { level: 2, name: "Channel apps" })).toBeTruthy();
  });

  it("names the organization in the empty list's line only where the server holds several", () => {
    stubs.allowed = new Set(["can_create_channel_app"]);
    renderSection();
    expect(screen.getByText("Add your own Slack app to give the bot acme's name and icon, or a Meta app to connect WhatsApp.")).toBeTruthy();
    cleanup();

    // A server that holds one organization never names it.
    stubs.singleOrg = true;
    renderSection();
    expect(screen.getByText("Add your own Slack app to give the bot this organization's name and icon, or a Meta app to connect WhatsApp.")).toBeTruthy();
  });
});
