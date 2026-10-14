/**
 * The skill page's version history, against an in-memory Connect backend:
 * the Versions tab shows the newest versions and loads older ones on
 * demand, and a server that serves no history (UNIMPLEMENTED) leaves the
 * tab out rather than failing the page.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { GrantQueryController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/query_pb";
import { StigmerContext } from "../../context.js";
import { SkillDetailView } from "../SkillDetailView.js";

afterEach(cleanup);

function renderView(history: boolean) {
  const transport = createRouterTransport(({ service }) => {
    service(SkillQueryController, {
      getByReference: () =>
        create(SkillSchema, { metadata: { id: "skl_1", org: "acme", slug: "triage", name: "triage" } }),
      listVersions: (input) => {
        if (!history) throw new ConnectError("no history here", Code.Unimplemented);
        return input.pageToken === ""
          ? { entries: [{ versionHash: "h2", tag: "v2", isCurrent: true }], nextPageToken: "older" }
          : { entries: [{ versionHash: "h1", tag: "v1" }], nextPageToken: "" };
      },
    });
    service(GrantQueryController, {
      checkMyPermission: () => ({ isAuthorized: false }),
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  render(<SkillDetailView org="acme" slug="triage" />, { wrapper });
}

describe("SkillDetailView: its versions", () => {
  it("shows the newest versions first and loads older ones on demand", async () => {
    renderView(true);
    fireEvent.click(await screen.findByRole("tab", { name: "Versions" }));
    expect(await screen.findByText("v2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("v1")).toBeTruthy();
  });

  it("leaves the tab out when the server serves no history", async () => {
    renderView(false);
    expect((await screen.findAllByText("triage")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: "Versions" })).toBeNull();
  });
});
