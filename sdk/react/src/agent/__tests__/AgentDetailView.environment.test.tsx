/**
 * AgentDetailView's "Environment" section: the Environment a conversation
 * on the agent runs in when the conversation names none.
 * - the read view names the agent's own, or says the organization's
 *   default applies ("None · uses the organization's default, <name>"),
 *   or "None";
 * - the editor's first row is the organization's default, and a save
 *   writes `spec.environment_ref` alone, with the picked Environment, or
 *   with none when the inherited row is chosen;
 * - a server refusal shows under the section;
 * - on a server whose conversations run in no sandbox it starts, the
 *   section says so.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentListSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const ENVIRONMENTS = create(EnvironmentListSchema, {
  entries: [
    create(EnvironmentSchema, { metadata: { id: "env_ds", org: ACME_ID, slug: "data-science", name: "Data science" } }),
    create(EnvironmentSchema, { metadata: { id: "env_bt", org: ACME_ID, slug: "base-tools", name: "Base tools" } }),
  ],
  nextPageToken: "",
});

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Analyst", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, spec);
  return agent;
}

function renderAgent(
  agent: Agent,
  opts: {
    update?: (resource: Agent, paths: string[]) => Promise<Agent>;
    organizationDefault?: string;
    applies?: boolean;
    editable?: boolean;
  } = {},
) {
  render(<AgentDetailView org="acme" slug="analyst" editable={opts.editable ?? true} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update: opts.update ?? vi.fn(async () => agent) },
        platform: {
          getServerInfo: vi.fn(async () => ({
            singleOrg: false,
            environments:
              opts.applies === undefined ? undefined : { applies: opts.applies, limitedNetworking: false, packages: true },
          })),
        },
        grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        environment: { list: vi.fn(async () => ENVIRONMENTS) },
        organization: {
          get: vi.fn(async () => ({
            metadata: { id: ACME_ID },
            spec: {
              preferences: opts.organizationDefault
                ? { defaultEnvironmentRef: { org: ACME_ID, slug: opts.organizationDefault } }
                : {},
            },
          })),
        },
      },
      undefined,
      true,
    ),
  });
}

describe("AgentDetailView environment", () => {
  it("names the agent's own Environment", async () => {
    renderAgent(agentWith({ environmentRef: { kind: ApiResourceKind.environment, org: ACME_ID, slug: "data-science" } }));
    expect(await screen.findByText("Data science")).toBeTruthy();
  });

  it("says the organization's default applies when the agent names none", async () => {
    renderAgent(agentWith({}), { organizationDefault: "base-tools" });
    expect(await screen.findByText("None · uses the organization's default, Base tools")).toBeTruthy();
  });

  it("says None when nothing applies", async () => {
    renderAgent(agentWith({}));
    await screen.findByRole("button", { name: "Edit environment" });
    const section = screen.getByRole("heading", { name: "Environment" }).closest("section")!;
    expect(within(section as HTMLElement).getByText("None")).toBeTruthy();
  });

  it("saves the picked Environment as spec.environment_ref alone", async () => {
    const agent = agentWith({});
    const update = vi.fn(async (resource: Agent, paths: string[]) => {
      void resource;
      void paths;
      return agent;
    });
    renderAgent(agent, { update, organizationDefault: "base-tools" });

    fireEvent.click(await screen.findByRole("button", { name: "Edit environment" }));
    const select = await screen.findByRole("combobox", { name: "Environment" });
    await screen.findByRole("option", { name: "Default: Base tools (the organization's default)" });
    await screen.findByRole("option", { name: "Data science" });
    fireEvent.change(select, { target: { value: "data-science" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Agent>(update);
    expect(sent.paths).toEqual(["spec.environment_ref"]);
    expect(sent.resource.spec?.environmentRef).toMatchObject({ slug: "data-science", kind: ApiResourceKind.environment });
  });

  it("clears the agent's own when the inherited row is saved", async () => {
    const agent = agentWith({ environmentRef: { kind: ApiResourceKind.environment, org: ACME_ID, slug: "data-science" } });
    const update = vi.fn(async (resource: Agent, paths: string[]) => {
      void resource;
      void paths;
      return agent;
    });
    renderAgent(agent, { update });

    fireEvent.click(await screen.findByRole("button", { name: "Edit environment" }));
    const select = await screen.findByRole("combobox", { name: "Environment" });
    await screen.findByRole("option", { name: "Data science" });
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Agent>(update);
    expect(sent.paths).toEqual(["spec.environment_ref"]);
    expect(sent.resource.spec?.environmentRef).toBeUndefined();
  });

  it("shows the server's refusal under the section", async () => {
    const update = vi.fn(async (resource: Agent, paths: string[]): Promise<Agent> => {
      void resource;
      void paths;
      throw new Error("referenced environment(s) not found: 'data-science'");
    });
    renderAgent(agentWith({}), { update });

    fireEvent.click(await screen.findByRole("button", { name: "Edit environment" }));
    const select = await screen.findByRole("combobox", { name: "Environment" });
    await screen.findByRole("option", { name: "Data science" });
    fireEvent.change(select, { target: { value: "data-science" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/not found: 'data-science'/);
  });

  it("says Environments don't apply on a server whose conversations run in no sandbox it starts", async () => {
    renderAgent(agentWith({ environmentRef: { kind: ApiResourceKind.environment, org: ACME_ID, slug: "data-science" } }), {
      applies: false,
      editable: false,
    });
    expect(
      await screen.findByText("Environments don't apply here: conversations on this server don't run in sandboxes it starts"),
    ).toBeTruthy();
  });
});
