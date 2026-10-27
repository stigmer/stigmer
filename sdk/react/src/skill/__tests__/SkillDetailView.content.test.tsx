/**
 * The skill page's Content tab for a skill with inline SKILL.md and git
 * provenance, against an in-memory Connect backend: the content opens as a
 * rendered preview and the view toggle switches it to the raw source, front
 * matter included; the Version section names the repository, the ref and the
 * commit shortened to seven characters.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { StigmerContext } from "../../context.js";
import { SkillDetailView } from "../SkillDetailView.js";

afterEach(cleanup);

const SKILL_MD = "---\nname: triage\n---\n# Triage incidents\n\nRead the pager first.";

function renderView() {
  const transport = createRouterTransport(({ service }) => {
    service(SkillQueryController, {
      getByReference: () =>
        create(SkillSchema, {
          metadata: { id: "skl_1", org: "acme", slug: "triage", name: "triage" },
          spec: { skillMd: SKILL_MD },
          status: {
            versionHash: "abcdef0123456789",
            gitProvenance: {
              remoteUrl: "git@github.com:acme/skills.git",
              ref: "main",
              commit: "1234567890abcdef",
            },
          },
        }),
      listVersions: () => {
        throw new ConnectError("no history here", Code.Unimplemented);
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

describe("SkillDetailView: its content", () => {
  it("opens the content as a preview and switches to the raw source", async () => {
    renderView();

    const toggle = await screen.findByRole("radiogroup", { name: "Content view mode" });
    expect(toggle).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Preview" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("heading", { name: "Triage incidents" })).toBeTruthy();
    expect(screen.queryByText(/name: triage/)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Source" }));
    expect(screen.getByRole("radio", { name: "Source" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/name: triage/).textContent).toBe(SKILL_MD);
  });

  it("names the repository, the ref and the short commit the skill came from", async () => {
    renderView();

    const repo = await screen.findByRole("link", { name: "acme/skills" });
    expect(repo.getAttribute("href")).toBe("https://github.com/acme/skills");
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("1234567")).toBeTruthy();
    expect(screen.queryByText("1234567890abcdef")).toBeNull();
  });
});
