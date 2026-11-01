/**
 * The agent page's acts for an owner and a reader (CON-01): the acts a
 * console host declares (Copy ID; Delete requiring `can_delete`; Start
 * session, which every reader may take) and the view's own YAML acts
 * (`yamlActions`: Edit YAML requiring `can_edit`, the exports nothing). The
 * view checks them on the agent it loaded: an owner is offered every act
 * and the inline edits; a reader is offered Start session, Copy ID and the
 * exports and sees a read-only page; and while the server has not
 * answered, the page is read-only from its first frame, with no Delete, no
 * Edit YAML and no pencil.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { samples } from "@stigmer/react-core/test";
import { AgentDetailView } from "../AgentDetailView";
import type { DetailAction } from "../../resource-detail/types";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const START_SESSION: DetailAction = { id: "start-session", label: "Start session", onAction: () => {} };
const HOST_ACTS: readonly DetailAction[] = [
  { id: "copy-id", label: "Copy ID", group: "clipboard", onAction: () => {} },
  { id: "delete", label: "Delete", group: "danger", variant: "destructive", requires: "can_delete", onAction: () => {} },
];

/** Who is looking: the owner holds every relation, a reader none, and "asking" is never answered. */
type Viewer = "owner" | "reader" | "asking";

function renderView(viewer: Viewer) {
  const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, { instructions: "Answer tickets.", plugins: [{ org: ACME_ID, slug: "linear" }] });
  const checkMyPermission = vi.fn((input: { relation: string; resource?: { kind: string; id: string } }) =>
    viewer === "asking" ? new Promise<never>(() => {}) : Promise.resolve({ isAuthorized: viewer === "owner" }),
  );
  render(<AgentDetailView org="acme" slug="support-bot" editable yamlActions primaryAction={START_SESSION} actions={HOST_ACTS} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update: vi.fn() },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission },
      },
      undefined,
      true,
    ),
  });
  return { agent, checkMyPermission };
}

describe("AgentDetailView: the acts each person is offered", () => {
  it("CON-01 offers the owner Start session, Edit YAML, Delete and the inline edits", async () => {
    const { agent, checkMyPermission } = renderView("owner");

    expect(await screen.findByRole("button", { name: "Edit plugins" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start session" })).toBeTruthy();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Edit YAML" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    // Each act is checked on the agent the view loaded.
    expect(checkMyPermission).toHaveBeenCalledWith(
      expect.objectContaining({ relation: "can_delete", resource: expect.objectContaining({ kind: "agent", id: agent.metadata?.id }) }),
    );
  });

  it("CON-01 offers a reader Start session and Copy ID, and a read-only page", async () => {
    renderView("reader");

    expect(await screen.findByRole("button", { name: "Start session" })).toBeTruthy();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy ID" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Export YAML" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit YAML" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.getByText("linear")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit plugins" })).toBeNull();
  });

  it("CON-01 is read-only from the first frame, with no Delete, while the server has not answered", async () => {
    renderView("asking");

    expect(await screen.findByRole("button", { name: "Start session" })).toBeTruthy();
    expect(screen.getByText("linear")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit plugins" })).toBeNull();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Edit YAML" })).toBeNull();
  });
});
