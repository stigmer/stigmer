/**
 * The plugin page for a plugin the organization has not installed: a
 * not-found answer is no failure, so the page says "Plugin not installed"
 * with why, in place of the plugin and its acts, and offers no retry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { StigmerContext } from "@stigmer/react-core";
import { PluginDetailView } from "../PluginDetailView.js";

afterEach(cleanup);

describe("PluginDetailView: a plugin the organization has not installed", () => {
  it("says the plugin is not installed, with no acts and no retry", async () => {
    const transport = createRouterTransport(({ service }) => {
      service(PluginQueryController, {
        getByReference: () => {
          throw new ConnectError("plugin not found", Code.NotFound);
        },
        listVersions: () => {
          throw new ConnectError("no history here", Code.Unimplemented);
        },
      });
    });
    const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
    );
    render(<PluginDetailView org="acme" slug="ghost" onStartChat={() => {}} />, { wrapper });

    expect(await screen.findByText("Plugin not installed")).toBeTruthy();
    expect(screen.getByText("No plugin with this name is installed in the organization.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start a chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });
});
