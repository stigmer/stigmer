/**
 * The skill page's acts for an owner and a reader (CON-01), with the acts
 * a console host declares (Copy ID; Delete requiring `can_delete`): the
 * view checks them on the skill it loaded, so an owner is offered Delete
 * and the editable metadata fields, and a reader is offered Copy ID alone
 * and sees a read-only page, from its first frame while the server has not
 * answered.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { StigmerContext } from "@stigmer/react-core";
import { SkillDetailView } from "../SkillDetailView.js";
import type { DetailAction } from "../../resource-detail/types.js";
import { openMenu } from "../../__tests__/helpers/open-menu";

afterEach(cleanup);

const HOST_ACTS: readonly DetailAction[] = [
  { id: "copy-id", label: "Copy ID", group: "clipboard", onAction: () => {} },
  { id: "delete", label: "Delete", group: "danger", variant: "destructive", requires: "can_delete", onAction: () => {} },
];

/** Who is looking: the owner holds every relation, a reader none, and "asking" is never answered. */
type Viewer = "owner" | "reader" | "asking";

function renderView(viewer: Viewer) {
  const asked: { relation: string; kind: string; id: string }[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(SkillQueryController, {
      getByReference: () =>
        create(SkillSchema, {
          metadata: { id: "skl_1", org: "acme", slug: "triage", name: "triage" },
          spec: { skillMd: "# Triage incidents" },
        }),
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
  render(<SkillDetailView org="acme" slug="triage" editable actions={HOST_ACTS} />, { wrapper });
  return { asked };
}

describe("SkillDetailView: the acts each person is offered", () => {
  it("CON-01 offers the owner Delete and the editable metadata", async () => {
    const { asked } = renderView("owner");

    expect(await screen.findByText("Tag")).toBeTruthy();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(asked).toContainEqual({ relation: "can_delete", kind: "skill", id: "skl_1" });
  });

  it("CON-01 offers a reader Copy ID alone, and a read-only page", async () => {
    renderView("reader");

    await openMenu(await screen.findByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy ID" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.queryByText("Tag")).toBeNull();
  });

  it("CON-01 is read-only from the first frame, with no Delete, while the server has not answered", async () => {
    renderView("asking");

    await openMenu(await screen.findByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.queryByText("Tag")).toBeNull();
  });
});
