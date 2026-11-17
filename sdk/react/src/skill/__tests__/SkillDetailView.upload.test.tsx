/**
 * "Upload a new version" on a skill's page: a new version is a fresh upload
 * of the same name, which the server allows only to who may upload to the
 * organization (`can_create_skill`). The view offers the act, drawn as an
 * outline button, to that person when its host names where Upload skill
 * is, and never to a member, on a plugin's skill, while the server has not
 * answered, or over a primary act the host passes itself (CON-01).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { StigmerContext } from "@stigmer/react-core";
import {
  SkillDetailView,
  type SkillDetailViewProps,
} from "../SkillDetailView.js";
import { PLUGIN_LABEL } from "../../plugin/useManagingPlugin.js";

afterEach(cleanup);

/** Who is looking: an admin may upload to the organization, a member may not, "asking" is never answered. */
type Viewer = "admin" | "member" | "asking";

interface Setup {
  readonly viewer: Viewer;
  readonly fromPlugin?: boolean;
  readonly props?: Partial<SkillDetailViewProps>;
}

function renderView({ viewer, fromPlugin = false, props = {} }: Setup) {
  const asked: { relation: string; kind: string; id: string }[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(SkillQueryController, {
      getByReference: () =>
        create(SkillSchema, {
          metadata: {
            id: "skl_1",
            org: "acme",
            slug: "triage",
            name: "triage",
            labels: fromPlugin ? { [PLUGIN_LABEL]: "plg_1" } : {},
          },
          spec: { skillMd: "# Triage incidents" },
        }),
      listVersions: () => {
        throw new ConnectError("no history here", Code.Unimplemented);
      },
    });
    service(PluginQueryController, {
      get: () =>
        create(PluginSchema, {
          metadata: {
            id: "plg_1",
            org: "acme",
            slug: "ledger",
            name: "Ledger",
          },
        }),
    });
    service(GrantQueryController, {
      checkMyPermission: (input) => {
        asked.push({
          relation: input.relation,
          kind: input.resource?.kind ?? "",
          id: input.resource?.id ?? "",
        });
        return viewer === "asking"
          ? new Promise<never>(() => {})
          : { isAuthorized: viewer === "admin" };
      },
    });
  });
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: transport,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  const onUploadNewVersion = vi.fn();
  render(
    <SkillDetailView
      org="acme"
      slug="triage"
      onUploadNewVersion={onUploadNewVersion}
      {...props}
    />,
    { wrapper },
  );
  return { asked, onUploadNewVersion };
}

const UPLOAD = { name: "Upload a new version" } as const;

describe("SkillDetailView: Upload a new version", () => {
  it("offers it to someone who may upload to the organization, as an outline button that goes to Upload skill", async () => {
    const { asked, onUploadNewVersion } = renderView({ viewer: "admin" });

    const button = await screen.findByRole("button", UPLOAD);
    expect(button.className).toContain("stg:border-border");
    expect(button.className).not.toContain("stg:bg-primary ");
    expect(asked).toContainEqual({
      relation: "can_create_skill",
      kind: "organization",
      id: "acme",
    });
    // The page re-renders as its version history settles; click the button on screen until the click lands.
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", UPLOAD));
      expect(onUploadNewVersion).toHaveBeenCalledOnce();
    });
  });

  it("CON-01 never offers it to a member the server refuses", async () => {
    const { asked } = renderView({ viewer: "member" });

    await screen.findByRole("heading", { name: "triage" });
    await waitFor(() =>
      expect(asked.some((a) => a.relation === "can_create_skill")).toBe(true),
    );
    expect(screen.queryByRole("button", UPLOAD)).toBeNull();
  });

  it("CON-01 does not offer it while the server has not answered", async () => {
    renderView({ viewer: "asking" });

    await screen.findByRole("heading", { name: "triage" });
    expect(screen.queryByRole("button", UPLOAD)).toBeNull();
  });

  it("does not offer it on a plugin's skill, which is the plugin's to redefine", async () => {
    renderView({ viewer: "admin", fromPlugin: true });

    expect(await screen.findByText(/Installed by the plugin/)).toBeTruthy();
    expect(screen.queryByRole("button", UPLOAD)).toBeNull();
  });

  it("asks nothing and offers nothing when the host names no Upload skill page", async () => {
    const { asked } = renderView({
      viewer: "admin",
      props: { onUploadNewVersion: undefined },
    });

    await screen.findByRole("heading", { name: "triage" });
    expect(screen.queryByRole("button", UPLOAD)).toBeNull();
    expect(asked.some((a) => a.relation === "can_create_skill")).toBe(false);
  });

  it("keeps a primary act the host passes itself", async () => {
    renderView({
      viewer: "admin",
      props: {
        primaryAction: { id: "run", label: "Try it", onAction: () => {} },
      },
    });

    expect(await screen.findByRole("button", { name: "Try it" })).toBeTruthy();
    expect(screen.queryByRole("button", UPLOAD)).toBeNull();
  });
});
