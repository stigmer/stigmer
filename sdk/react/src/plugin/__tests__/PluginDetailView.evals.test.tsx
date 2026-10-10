/**
 * The plugin page's Evals tab, against an in-memory Connect backend. Pins:
 * the tab sits beside Overview on every plugin page; opening it shows the
 * suite install read and the plugin's past evals through `listByPlugin`;
 * a try opens its run through the host's `onNavigateToRun`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { PluginEvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/query_pb";
import { PluginEvalListSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context.js";
import { PluginDetailView } from "../PluginDetailView.js";
import { evalWith } from "../../plugin-eval/__tests__/eval-fixture.js";

vi.mock("../../models/ModelSelector.js", () => ({
  ModelSelector: () => <span>model picker</span>,
}));

afterEach(cleanup);

function renderView(onNavigateToRun: (runId: string) => void) {
  const latest = evalWith([{ name: "review-fires", score: 1, delta: 0.67 }]);
  const listByPlugin = vi.fn(() =>
    create(PluginEvalListSchema, { totalCount: 1, items: [latest] }),
  );
  const transport = createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      getByReference: () =>
        create(PluginSchema, {
          metadata: create(ApiResourceMetadataSchema, {
            id: "plg_1",
            org: "acme",
            slug: "thermos",
            name: "thermos",
          }),
          status: create(PluginStatusSchema, {
            evals: {
              dir: "evals",
              caseCount: 1,
              cases: [{ caseName: "review-fires", path: "evals/review-fires" }],
            },
          }),
        }),
    });
    service(PluginEvalQueryController, {
      listByPlugin,
      get: () => latest,
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
  render(
    <PluginDetailView
      org="acme"
      slug="thermos"
      onNavigateToRun={onNavigateToRun}
    />,
    { wrapper },
  );
  return { listByPlugin };
}

describe("PluginDetailView: the Evals tab", () => {
  it("opens to the suite and the plugin's evals, and a try opens its run", async () => {
    const onNavigateToRun = vi.fn();
    const { listByPlugin } = renderView(onNavigateToRun);
    const tabs = (await screen.findAllByRole("tab")).map(
      (tab) => tab.textContent,
    );
    expect(tabs.slice(0, 2)).toEqual(["Overview", "Evals"]);
    fireEvent.click(screen.getByRole("tab", { name: "Evals" }));
    expect(await screen.findByText(/1 case in/)).toBeDefined();
    fireEvent.click(
      await screen.findByRole("button", { name: "review-fires" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "with #1: 1.00" }));
    expect(onNavigateToRun).toHaveBeenCalledWith("run_review-fires_1");
    expect(listByPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "plg_1" }),
      expect.anything(),
    );
  });
});
