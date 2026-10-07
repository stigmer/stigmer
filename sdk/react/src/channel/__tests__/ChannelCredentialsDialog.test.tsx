/**
 * The channel's credentials dialog: a channel conversation has no person
 * behind it, so it takes only what the channel assigns. Pinned: the rows
 * are the agent's requirements per declarer; the sources offered are the
 * organization's credentials the caller may use (never their own: a
 * person's credential is refused on a channel); a save is a full-input
 * apply with only the assignments changed and no writer sent; an emptied
 * list removes every assignment; an unassigned required value is named;
 * an agent that needs nothing says so.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannelInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { storedCredential } from "../../credential/__tests__/credential-world";
import { ChannelCredentialsDialog } from "../ChannelCredentialsDialog";

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

const GITHUB = { kind: "mcp_server", org: "acme", slug: "github" } as const;

function makeAgent(withTools = true) {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "acme", slug: "support-agent", name: "Support Agent" },
    spec: {
      instructions: "help",
      mcpServerUsages: withTools ? [{ mcpServerRef: { org: "acme", slug: "github" } }] : [],
    },
  });
}

/** A stored assignment of GITHUB_TOKEN for the GitHub server from `slug`. */
function githubAssignment(slug: string) {
  return {
    requirement: { declarer: { target: { case: "mcpServer", value: { org: "acme", slug: "github" } } }, key: "GITHUB_TOKEN" },
    source: { case: "credential", value: { credential: { org: "acme", slug }, field: "" } },
    writer: "ida_owner",
  };
}

function makeChannel(credentials: unknown[] = []) {
  return {
    metadata: { id: "ach_1", name: "Support Slack", slug: "support-slack", org: "acme", labels: {} },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      providerConfig: { case: "slack", value: {} },
      credentials,
    },
    status: { installState: 2 },
  } as never;
}

function createMockStigmer(overrides: { apply?: (input: AgentChannelInput) => Promise<unknown> } = {}) {
  return {
    agentChannel: { apply: overrides.apply ?? vi.fn().mockResolvedValue({}) },
    mcpServer: {
      getByReference: vi.fn().mockResolvedValue({
        metadata: { id: "mcp_github", org: "acme", slug: "github", name: "GitHub" },
        spec: { env: { GITHUB_TOKEN: { isSecret: true } } },
      }),
    },
    credential: {
      list: vi.fn().mockResolvedValue({
        items: [
          storedCredential({ id: "github-credentials", org: "acme", owner: "org", name: "GitHub Credentials", fields: ["GITHUB_TOKEN"], serves: [GITHUB] }),
          storedCredential({ id: "my-token", org: "acme", owner: "person", name: "My Token", fields: ["GITHUB_TOKEN"] }),
        ],
        totalCount: 2,
      }),
    },
  } as never;
}

function Providers({ client, children }: { client: unknown; children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <DeploymentModeContext.Provider value="cloud">
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </DeploymentModeContext.Provider>
    </FetchCacheContext.Provider>
  );
}

function renderDialog(client: unknown, channel = makeChannel(), agent = makeAgent()) {
  render(
    <Providers client={client}>
      <ChannelCredentialsDialog open onOpenChange={() => {}} agent={agent} channel={channel} />
    </Providers>,
  );
}

describe("ChannelCredentialsDialog", () => {
  it("offers the organization's keys and never the caller's own", async () => {
    renderDialog(createMockStigmer());

    await screen.findByLabelText("GITHUB_TOKEN", { selector: "select" });
    expect(await screen.findByRole("option", { name: "GitHub Credentials", hidden: true })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "My Token", hidden: true })).toBeNull();
  });

  it("saves the full input with the new assignment and no writer — nothing else is dropped", async () => {
    const apply = vi.fn().mockResolvedValue({});
    renderDialog(createMockStigmer({ apply }));

    const source = await screen.findByLabelText("GITHUB_TOKEN", { selector: "select" });
    await screen.findByRole("option", { name: "GitHub Credentials", hidden: true });
    fireEvent.change(source, { target: { value: "cred:acme/github-credentials" } });
    fireEvent.click(screen.getByRole("button", { name: "Save", hidden: true }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const input = apply.mock.calls[0][0] as AgentChannelInput;
    expect(input.credentials).toEqual([
      {
        requirement: { declarer: { mcpServer: { org: "acme", slug: "github" } }, key: "GITHUB_TOKEN" },
        credential: { credential: { org: "acme", slug: "github-credentials" } },
      },
    ]);
    expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
    expect(input.slack).toEqual({});
    expect(input.enabled).toBe(true);
  });

  it("saves an emptied list as removing every assignment", async () => {
    const apply = vi.fn().mockResolvedValue({});
    renderDialog(createMockStigmer({ apply }), makeChannel([githubAssignment("github-credentials")]));

    const source = await screen.findByLabelText("GITHUB_TOKEN", { selector: "select" });
    fireEvent.change(source, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save", hidden: true }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const input = apply.mock.calls[0][0] as AgentChannelInput;
    expect(input.credentials).toEqual([]);
  });

  it("names a required value nothing assigns", async () => {
    renderDialog(createMockStigmer());

    expect(await screen.findByText(/Runs will not start until this value is assigned/)).toBeTruthy();
  });

  it("says an agent that needs nothing starts with nothing assigned", async () => {
    renderDialog(createMockStigmer(), makeChannel(), makeAgent(false));

    expect(await screen.findByText(/This agent needs no keys/)).toBeTruthy();
  });
});
