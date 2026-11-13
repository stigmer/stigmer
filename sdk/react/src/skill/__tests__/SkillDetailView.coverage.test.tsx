/**
 * The skill page for a skill the server does not know: a not-found answer
 * is no failure, so the page says "Skill not found" with why, in place of
 * the skill and its acts, and offers no retry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { StigmerContext } from "@stigmer/react-core";
import { SkillDetailView } from "../SkillDetailView.js";

afterEach(cleanup);

describe("SkillDetailView: a skill the server does not know", () => {
  it("says the skill was not found, with no acts and no retry", async () => {
    const transport = createRouterTransport(({ service }) => {
      service(SkillQueryController, {
        getByReference: () => {
          throw new ConnectError("skill not found", Code.NotFound);
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
    render(<SkillDetailView org="acme" slug="ghost" />, { wrapper });

    expect(await screen.findByText("Skill not found")).toBeTruthy();
    expect(screen.getByText("This skill doesn't exist or you don't have access to it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });
});
