import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannelInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
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

function makeAgent(withTools = true) {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "acme", slug: "support-agent", name: "Support Agent" },
    spec: {
      instructions: "help",
      plugins: withTools
        ? [{ org: "acme", slug: "github" }]
        : [],
    },
  });
}

function makeChannel(vaults: { org: string; slug: string }[] = []) {
  return {
    metadata: {
      id: "ach_1",
      name: "Support Slack",
      slug: "support-slack",
      org: "acme",
      labels: {},
    },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      providerConfig: { case: "slack", value: {} },
      vaults,
    },
    status: { installState: 2 },
  } as never;
}

function createMockStigmer(overrides: {
  apply?: (input: AgentChannelInput) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
    },
    vault: {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            metadata: { slug: "github-credentials", name: "GitHub Credentials", org: "acme" },
            spec: { owner: { case: "org", value: "acme" } },
          },
          {
            metadata: { slug: "my-vault-ana", name: "My vault", org: "acme" },
            spec: { owner: { case: "person", value: "ida_ana" } },
          },
        ],
        totalCount: 2,
      }),
      getByReference: vi.fn().mockImplementation(({ slug }: { slug: string }) =>
        Promise.resolve({
          spec: {
            owner: { case: slug === "github-credentials" ? "org" : "person" },
          },
        }),
      ),
    },
  } as never;
}

function Providers({
  client,
  children,
}: {
  client: unknown;
  children: ReactNode;
}) {
  return (
    <FetchCacheContext.Provider value={null}>
      <DeploymentModeContext.Provider value="cloud">
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </DeploymentModeContext.Provider>
    </FetchCacheContext.Provider>
  );
}

describe("ChannelCredentialsDialog", () => {
  it("offers shared vaults in the picker, never the viewer's own My vault", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <ChannelCredentialsDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channel={makeChannel()}
        />
      </Providers>,
    );

    // A channel's runs have no person, and the server refuses a My vault
    // on a channel, so the picker never offers it.
    expect(
      await screen.findByRole("option", { name: "GitHub Credentials" }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "My vault" })).toBeNull();
  });

  it("saves the full input with the updated bindings — nothing else is dropped", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const onSaved = vi.fn();

    render(
      <Providers client={createMockStigmer({ apply })}>
        <ChannelCredentialsDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channel={makeChannel()}
          onSaved={onSaved}
        />
      </Providers>,
    );

    // Name the shared vault through the picker.
    const select = await screen.findByLabelText("Add vault");
    fireEvent.change(select, { target: { value: "github-credentials" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The save is a full-input apply: the agent reference and provider
    // marker survive alongside the new binding (apply semantics would
    // silently unbind whatever a partial input omitted).
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Support Slack",
          org: "acme",
          agentRef: { org: "acme", slug: "support-agent" },
          enabled: true,
          slack: {},
          vaults: [{ org: "acme", slug: "github-credentials" }],
        }),
      ),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("saves an emptied list as an explicit unbind", async () => {
    const apply = vi.fn().mockResolvedValue({});

    render(
      <Providers client={createMockStigmer({ apply })}>
        <ChannelCredentialsDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channel={makeChannel([{ org: "acme", slug: "github-credentials" }])}
        />
      </Providers>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /remove github credentials/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ vaults: [] }),
      ),
    );
  });

  it("shows the needs-credentials hint for a tool-using agent with no bindings", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <ChannelCredentialsDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channel={makeChannel()}
        />
      </Providers>,
    );

    expect(
      await screen.findByText(/this channel names no vault/i),
    ).toBeTruthy();
  });

  it("stays silent for agents without tools", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <ChannelCredentialsDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent(false)}
          channel={makeChannel()}
        />
      </Providers>,
    );

    await screen.findByLabelText("Add vault");
    expect(screen.queryByText(/this channel names no vault/i)).toBeNull();
  });
});
