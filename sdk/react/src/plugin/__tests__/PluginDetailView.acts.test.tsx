/**
 * The plugin page's acts for an owner and a reader (CON-01), with the acts
 * a console host declares (Copy ID; Remove requiring `can_delete`): the
 * view checks them on the plugin it loaded, so the owner is offered Remove
 * and a reader is not, neither while the server has not answered; "Start a
 * chat", which changes nothing, is every reader's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { StigmerContext } from "@stigmer/react-core";
import { PluginDetailView } from "../PluginDetailView.js";
import type { DetailAction } from "../../resource-detail/types.js";
import { openMenu } from "../../__tests__/helpers/open-menu";

afterEach(cleanup);

const HOST_ACTS: readonly DetailAction[] = [
  { id: "copy-id", label: "Copy ID", group: "clipboard", onAction: () => {} },
  { id: "remove", label: "Remove", group: "danger", variant: "destructive", requires: "can_delete", onAction: () => {} },
];

/** Who is looking: the owner holds every relation, a reader none, and "asking" is never answered. */
type Viewer = "owner" | "reader" | "asking";

function renderView(viewer: Viewer) {
  const asked: { relation: string; kind: string; id: string }[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      getByReference: () => create(PluginSchema, { metadata: { id: "plg_1", org: "acme", slug: "linear", name: "linear" } }),
      listVersions: () => {
        throw new ConnectError("no history here", Code.Unimplemented);
      },
    });
    service(GrantQueryController, {
      checkMyPermission: (input) => {
        asked.push({ relation: input.relation, kind: input.resource?.kind ?? "", id: input.resource?.id ?? "" });
        return viewer === "asking" ? new Promise<never>(() => {}) : { isAuthorized: viewer === "owner" };
      },
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  render(<PluginDetailView org="acme" slug="linear" onStartChat={() => {}} actions={HOST_ACTS} />, { wrapper });
  return { asked };
}

describe("PluginDetailView: the acts each person is offered", () => {
  it("CON-01 offers the owner Remove", async () => {
    const { asked } = renderView("owner");

    await openMenu(await screen.findByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Remove" })).toBeTruthy();
    expect(asked).toContainEqual({ relation: "can_delete", kind: "plugin", id: "plg_1" });
  });

  it("CON-01 offers a reader Start a chat and Copy ID, and no Remove", async () => {
    renderView("reader");

    expect((await screen.findAllByRole("button", { name: "Start a chat" })).length).toBeGreaterThan(0);
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy ID" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  it("CON-01 offers no Remove while the server has not answered", async () => {
    renderView("asking");

    await openMenu(await screen.findByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });
});
