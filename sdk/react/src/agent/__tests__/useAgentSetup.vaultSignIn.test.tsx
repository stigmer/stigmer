/**
 * A sign-in an agent owes in a conversation that lists vaults is saved into
 * the first listed vault, where the conversation's runs read logins, never
 * into My vault, which they never read. Pinned end to end over the
 * composer's own pieces (useAgentSetup and the McpServerReadiness row):
 * the pending sign-in names the listed vault; the row offers Sign in even
 * though My vault holds a grant; the sign-in sends that vault's id and
 * organization and chains no discovery (the connect lane reads only My
 * vault); once the listed vault holds the sign-in, the agent is ready. A
 * person who may not edit that vault is told that this conversation's
 * vaults must hold the login and who can put it there.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  CompleteOAuthConnectOutputSchema,
  GetOAuthGrantStatusOutputSchema,
  InitiateOAuthConnectOutputSchema,
  OAuthConnectionHealth,
  type InitiateOAuthConnectInput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSchema, VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { McpServerReadiness } from "../../plugin/McpServerReadiness";
import { useAgentSetup } from "../useAgentSetup";

vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => ({ location: { href: "" }, closed: false })),
  popupBlockedError: vi.fn(() => new Error("Popup was blocked by the browser.")),
  waitForOAuthCallback: vi.fn(async () => ({ code: "auth-code", state: "state-1" })),
  closeOAuthPopup: vi.fn(),
  OAUTH_CALLBACK_MESSAGE_TYPE: "stigmer:oauth:callback",
  OAUTH_BROADCAST_CHANNEL: "stigmer:oauth:broadcast",
}));

afterEach(cleanup);

const ORG = "acme";
const REF = { org: ORG, slug: "reviewer" };
const LISTED = [{ org: ORG, slug: "team" }];
const LINEAR_URL = "https://linear.example/mcp";

const linear = create(McpServerSchema, {
  metadata: { id: "mcp_linear", org: ORG, slug: "linear", name: "Linear" },
  spec: {
    serverType: { case: "http", value: { url: LINEAR_URL } },
    auth: { targetEnvVar: "LINEAR_ACCESS_TOKEN", oauthOnly: true },
    env: { LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  },
});

interface World {
  /** The listed vault, which a landed sign-in fills. */
  team: ReturnType<typeof teamVault>;
  /** What each sign-in asked for. */
  readonly initiated: InitiateOAuthConnectInput[];
  /** Whether the chained discovery ran. */
  connects: number;
  /** How many times My vault's grant was read. */
  grantReads?: number;
  /** When set, the person may not edit the listed vault. */
  readonly refuse?: boolean;
}

function teamVault(signedIn: boolean) {
  return create(VaultSchema, {
    metadata: { id: "vlt_team", org: "org_acme", slug: "team", name: "Team tools" },
    spec: {
      owner: { case: "org", value: "org_acme" },
      connections: signedIn
        ? {
            [LINEAR_URL]: create(VaultConnectionSchema, {
              source: VaultConnectionSource.sign_in,
              signIn: { mcpServerId: "mcp_linear" },
            }),
          }
        : {},
    },
  });
}

function client(world: World) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: () =>
          create(AgentSchema, {
            metadata: { id: "agt_1", org: ORG, slug: REF.slug, name: "Reviewer" },
            spec: {
              env: { LINEAR_ACCESS_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
              mcpServerUsages: [create(McpServerUsageSchema, { mcpServerRef: { org: ORG, slug: "linear" } })],
            },
          }),
      });
      service(McpServerQueryController, {
        getByReference: () => linear,
        get: () => linear,
        // My vault holds a healthy grant: it serves only conversations that read My vault.
        getOAuthGrantStatus: () => {
          world.grantReads = (world.grantReads ?? 0) + 1;
          return create(GetOAuthGrantStatusOutputSchema, {
            connected: true,
            connectionHealth: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
          });
        },
      });
      service(McpServerCommandController, {
        initiateOAuthConnect: (input) => {
          world.initiated.push(input);
          if (world.refuse) throw new ConnectError("unauthorized to save a sign-in in this vault", Code.PermissionDenied);
          return create(InitiateOAuthConnectOutputSchema, { authorizationUrl: "https://linear.example/authorize", state: "state-1" });
        },
        completeOAuthConnect: () => {
          world.team = teamVault(true);
          return create(CompleteOAuthConnectOutputSchema, { connected: true });
        },
        connect: () => {
          world.connects += 1;
          return linear;
        },
      });
      service(VaultQueryController, {
        getMine: () => {
          throw new ConnectError("no My vault yet", Code.NotFound);
        },
        getByReference: () => world.team,
      });
    }),
  });
}

/** The composer's agent rows, reduced to what this rule needs. */
function AgentSignIns() {
  const setup = useAgentSetup(ORG, undefined, LISTED);
  const { resolveAgent } = setup;
  useEffect(() => {
    resolveAgent(REF).catch(() => undefined);
  }, [resolveAgent]);
  if (setup.state.status !== "needsEnvVars") return <p>Agent is {setup.state.status}</p>;
  return (
    <ul aria-label="Sign-ins this agent needs">
      {setup.state.pendingSignIns.map((signIn) => (
        <li key={signIn.id}>
          <span>Saves into {signIn.vault?.name ?? "My vault"}</span>
          <McpServerReadiness
            org={signIn.ref.org}
            slug={signIn.ref.slug}
            keysAskedAt="agent"
            signInVault={signIn.vault}
            onSignedIn={(id) => {
              void setup.signInCompleted(id);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function renderWith(world: World) {
  const stigmer = client(world);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(<AgentSignIns />, { wrapper: Wrapper });
}

describe("a sign-in owed in a conversation that lists vaults", () => {
  it("is saved into the first listed vault, and the agent is ready once that vault holds it", async () => {
    const world: World = { team: teamVault(false), initiated: [], connects: 0 };
    renderWith(world);

    expect(await screen.findByText("Saves into Team tools")).toBeTruthy();
    const signIn = await screen.findByRole("button", { name: "Sign in to Linear" });
    // My vault's healthy grant is not this conversation's: once it is read, the row still says so.
    await waitFor(() => expect(world.grantReads).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("Sign-in required")).toBeTruthy();
    expect(screen.queryByText("Signed in")).toBeNull();
    fireEvent.click(signIn);

    expect(await screen.findByText("Agent is ready")).toBeTruthy();
    expect(world.initiated).toHaveLength(1);
    expect(world.initiated[0]).toMatchObject({ mcpServerId: "mcp_linear", org: "org_acme", vaultId: "vlt_team" });
    expect(world.connects).toBe(0);
  });

  it("tells a person who may not edit that vault that its vaults must hold the login, and who can put it there", async () => {
    const world: World = { team: teamVault(false), initiated: [], connects: 0, refuse: true };
    renderWith(world);

    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Linear" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "This conversation uses only its vaults, so the sign-in must be saved in vault 'Team tools', which you may not edit. " +
        "Ask an admin of that vault to sign in there, or to let you edit it.",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in to Linear" })).toBeTruthy());
    expect(screen.queryByText("Agent is ready")).toBeNull();
  });
});
