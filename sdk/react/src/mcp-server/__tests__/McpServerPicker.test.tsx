/**
 * Pins the picker's sign-in arms over a real `useMcpServerSetup`: a
 * discovery-leg failure retries bare discovery and never reopens the popup,
 * any other failure relaunches the OAuth popup, a usable grant with nothing
 * discovered offers discovery, the shared hooks' signals stay with the
 * server an attempt was started for, and a sign-in is saved in My vault
 * and reported to the setup (`onSignedIn`), so a composer whose
 * conversation leaves My vault out can include it.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import type { ResourceRef } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import {
  OAuthConnectionHealth,
  GetOAuthGrantStatusOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  CompleteSignInOutputSchema,
  StartSignInOutputSchema,
  type StartSignInInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import {
  McpServerSpecSchema,
  McpServerAuthSchema,
  HttpServerConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  McpServerStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredToolSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { McpServerPicker } from "../McpServerPicker";
import { useMcpServerSetup } from "../useMcpServerSetup";
import type { ConversationVaults } from "../../vault/conversationVaults";
import * as oauthPopup from "../../internal/oauthPopup.js";

// The popup machinery is window-dependent (window.open, postMessage,
// BroadcastChannel); these tests drive the RPC chain, so replace it with
// a deterministic callback handshake. The `openOAuthPopup` call count is
// the load-bearing assertion of this suite: a discovery-leg retry must
// NEVER reopen the popup (stigmer/stigmer#418).
vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => ({ location: { href: "" }, closed: false })),
  popupBlockedError: vi.fn(
    () => new Error("Popup was blocked by the browser."),
  ),
  waitForOAuthCallback: vi.fn(async () => ({
    code: "auth-code",
    state: "state-1",
  })),
  closeOAuthPopup: vi.fn(),
  OAUTH_CALLBACK_MESSAGE_TYPE: "stigmer:oauth:callback",
  OAUTH_BROADCAST_CHANNEL: "stigmer:oauth:broadcast",
}));

const openOAuthPopupMock = vi.mocked(oauthPopup.openOAuthPopup);

beforeAll(() => {
  // happy-dom lacks ResizeObserver, which the scroll-shadow machinery
  // observes.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ORG = "acme";
const SLUG = "order-management-api";
const SERVER_NAME = "Order Management API";

function serverRef(slug = SLUG): ResourceRef {
  return { org: ORG, slug, kind: ApiResourceKind.mcp_server };
}

/**
 * An OAuth-only server before any discovery: one declared env var that is
 * also the OAuth target, no discovered capabilities.
 */
function buildOAuthServer(o?: { name?: string; slug?: string; id?: string }): McpServer {
  const server = samples.mcpServer({
    name: o?.name ?? SERVER_NAME,
    org: ORG,
    slug: o?.slug ?? SLUG,
    id: o?.id ?? "mcp-00000000-0000-0000-0000-00000000041a",
  });
  server.spec = create(McpServerSpecSchema, {
    description: "REST API for order lookup and return processing.",
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://api.acme.com/mcp" }),
    },
    env: {
      API_TOKEN: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "OAuth access token",
      }),
    },
    auth: create(McpServerAuthSchema, {
      targetEnvVar: "API_TOKEN",
      oauthOnly: true,
    }),
  });
  return server;
}

/** The same server after a successful discovery: three tools. */
function buildDiscoveredServer(): McpServer {
  const server = buildOAuthServer();
  server.status = create(McpServerStatusSchema, {
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      tools: [
        create(DiscoveredToolSchema, { name: "get_order" }),
        create(DiscoveredToolSchema, { name: "list_orders" }),
        create(DiscoveredToolSchema, { name: "process_return" }),
      ],
    }),
  });
  return server;
}

function grantStatusOutput(
  connected: boolean,
  health: OAuthConnectionHealth,
) {
  return create(GetOAuthGrantStatusOutputSchema, {
    connected,
    connectionHealth: health,
    targetEnvVar: connected ? "API_TOKEN" : "",
    authMethod: connected ? "mcp_oauth" : "",
  });
}

/**
 * Composes the picker with a real `useMcpServerSetup`, wired exactly the
 * way `SessionComposer` wires it. The given refs are added once on mount.
 */
function PickerHarness({
  refs,
  choice,
  onSignedIn,
}: {
  readonly refs: readonly ResourceRef[];
  readonly choice?: ConversationVaults;
  readonly onSignedIn?: (ref: ResourceRef) => void;
}) {
  const setup = useMcpServerSetup(ORG, undefined, choice);
  const addedRef = useRef(false);
  const { addServer } = setup;
  useEffect(() => {
    if (addedRef.current) return;
    addedRef.current = true;
    for (const ref of refs) void addServer(ref);
  }, [refs, addServer]);

  return (
    <>
      <McpServerPicker
        org={ORG}
        setup={{
          entries: setup.entries,
          onServerAdded: (ref) => void setup.addServer(ref),
          onServerRemoved: setup.removeServer,
          onSubmitEnvVars: (ref, values) => void setup.submitEnvVars(ref, values),
          onSignedIn,
        }}
      />
      <p data-testid="setup-status">{setup.entries[`${ORG}/${SLUG}`]?.status ?? "none"}</p>
    </>
  );
}

/**
 * Mounts the harness against a real Connect router transport. RPCs a test
 * does not register fall through to Connect's `unimplemented`, which the
 * SDK hooks degrade from (search list and My vault lookups
 * are irrelevant here and stay unregistered).
 */
function renderPicker(
  register: Parameters<typeof createRouterTransport>[0],
  refs: readonly ResourceRef[] = [serverRef()],
  conversation: { readonly choice?: ConversationVaults; readonly onSignedIn?: (ref: ResourceRef) => void } = {},
) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
  return render(
    <StigmerContext.Provider value={client}>
      <PickerHarness refs={refs} choice={conversation.choice} onSignedIn={conversation.onSignedIn} />
    </StigmerContext.Provider>,
  );
}

async function drillIntoConfigure(buttonName: RegExp) {
  const configure = await screen.findByRole("button", { name: buttonName });
  fireEvent.click(configure);
}

describe("McpServerPicker — discovery-leg failure (in-flow arm)", () => {
  function registerFailingDiscovery() {
    // Mutable fixture state: the grant flips to connected at token
    // exchange (the two-act persistence contract), and discovery starts
    // failing, then succeeds once `discoveryFails` is cleared.
    const state = {
      server: buildOAuthServer(),
      grantConnected: false,
      discoveryFails: true,
    };
    const connectSpy = vi.fn(() => {
      if (state.discoveryFails) {
        throw new ConnectError("discovery workflow failed", Code.Internal);
      }
      state.server = buildDiscoveredServer();
      return state.server;
    });

    const register: Parameters<typeof createRouterTransport>[0] = (
      router,
    ) => {
      router.service(McpServerQueryController, {
        getByReference: () => state.server,
        get: () => state.server,
        getOAuthGrantStatus: () =>
          grantStatusOutput(
            state.grantConnected,
            state.grantConnected
              ? OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY
              : OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
          ),
      });
      router.service(VaultCommandController, {
        startSignIn: () =>
          create(StartSignInOutputSchema, {
            authorizationUrl: "https://vendor.example/authorize",
            state: "state-1",
          }),
        completeSignIn: () => {
          state.grantConnected = true;
          return create(CompleteSignInOutputSchema, {});
        },
      });
      router.service(McpServerCommandController, {
        connect: connectSpy,
      });
    };

    return { state, connectSpy, register };
  }

  async function signInAndFailDiscovery() {
    await drillIntoConfigure(new RegExp(`Configure ${SLUG}`));
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Sign in with ${SERVER_NAME}`,
      }),
    );
    // Honest copy: the sign-in succeeded, only the discovery leg broke.
    await screen.findByText(
      /Signed in successfully, but tool discovery failed/,
    );
  }

  it("renders the honest copy, stranded status, and a Discover tools action", async () => {
    const { register } = registerFailingDiscovery();
    renderPicker(register);

    await signInAndFailDiscovery();

    expect(
      screen.getByText("Signed in — tools not discovered yet"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Discover tools" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: `Sign in with ${SERVER_NAME}` }),
    ).toBeNull();
  });

  it("retries with a bare connect and never reopens the popup", async () => {
    const { state, connectSpy, register } = registerFailingDiscovery();
    renderPicker(register);

    await signInAndFailDiscovery();
    expect(openOAuthPopupMock).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);

    state.discoveryFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Discover tools" }));

    // Discovery succeeded → the entry re-resolves ready with real tools;
    // the stranded state and its affordance retire themselves.
    await waitFor(() =>
      expect(
        screen.queryByText("Signed in — tools not discovered yet"),
      ).toBeNull(),
    );
    await screen.findByText("process_return");
    expect(
      screen.queryByRole("button", { name: "Discover tools" }),
    ).toBeNull();
    expect(connectSpy).toHaveBeenCalledTimes(2);
    expect(openOAuthPopupMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a failing bare retry honest and popup-free", async () => {
    const { connectSpy, register } = registerFailingDiscovery();
    renderPicker(register);

    await signInAndFailDiscovery();
    fireEvent.click(screen.getByRole("button", { name: "Discover tools" }));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledTimes(2));
    // Still stranded, still honest, still no second popup.
    await screen.findByText(
      /Signed in successfully, but tool discovery failed/,
    );
    expect(
      screen.getByRole("button", { name: "Discover tools" }),
    ).toBeTruthy();
    expect(openOAuthPopupMock).toHaveBeenCalledTimes(1);
  });

  it("routes a non-discovery failure back through the OAuth popup", async () => {
    renderPicker((router) => {
      router.service(McpServerQueryController, {
        getByReference: () => buildOAuthServer(),
        get: () => buildOAuthServer(),
        getOAuthGrantStatus: () =>
          grantStatusOutput(
            false,
            OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
          ),
      });
      router.service(VaultCommandController, {
        startSignIn: () =>
          create(StartSignInOutputSchema, {
            authorizationUrl: "https://vendor.example/authorize",
            state: "state-1",
          }),
        completeSignIn: () => {
          throw new ConnectError("token exchange failed", Code.Unavailable);
        },
      });
    });

    await drillIntoConfigure(new RegExp(`Configure ${SLUG}`));
    const signIn = await screen.findByRole("button", {
      name: `Sign in with ${SERVER_NAME}`,
    });

    fireEvent.click(signIn);
    await screen.findByText(/token exchange failed/);
    // Sign-in itself failed — no "signed in successfully" framing, and the
    // action remains a full OAuth relaunch.
    expect(
      screen.queryByText(/Signed in successfully/),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: `Sign in with ${SERVER_NAME}` }),
    );
    await waitFor(() => expect(openOAuthPopupMock).toHaveBeenCalledTimes(2));
  });
});

describe("McpServerPicker — stranded server truth (reopen/re-add arm)", () => {
  it("offers Discover tools for a usable grant with zero discovered tools", async () => {
    let server = buildOAuthServer();
    const connectSpy = vi.fn(() => {
      server = buildDiscoveredServer();
      return server;
    });

    renderPicker((router) => {
      router.service(McpServerQueryController, {
        getByReference: () => server,
        getOAuthGrantStatus: () =>
          grantStatusOutput(
            true,
            OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
          ),
      });
      router.service(McpServerCommandController, { connect: connectSpy });
    });

    // Grant exists → the entry resolves ready, but with nothing discovered.
    await drillIntoConfigure(new RegExp(`Configure ${SLUG}`));

    await screen.findByText("Signed in — tools not discovered yet");
    fireEvent.click(
      await screen.findByRole("button", { name: "Discover tools" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText("Signed in — tools not discovered yet"),
      ).toBeNull(),
    );
    await screen.findByText("process_return");
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(openOAuthPopupMock).not.toHaveBeenCalled();
  });

  it("offers re-auth, not discovery, for an expired grant", async () => {
    renderPicker((router) => {
      router.service(McpServerQueryController, {
        getByReference: () => buildOAuthServer(),
        getOAuthGrantStatus: () =>
          grantStatusOutput(
            true,
            OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED,
          ),
      });
    });

    await drillIntoConfigure(new RegExp(`Configure ${SLUG}`));

    await screen.findByRole("button", { name: "Sign in to reconnect" });
    expect(screen.queryByRole("button", { name: "Discover tools" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in to reconnect" }),
    );
    await waitFor(() => expect(openOAuthPopupMock).toHaveBeenCalledTimes(1));
  });
});

describe("McpServerPicker — cross-server scoping", () => {
  it("keeps server A's discovery failure out of server B's configure view", async () => {
    const SLUG_B = "billing-api";
    const NAME_B = "Billing API";
    const serverA = buildOAuthServer();
    const serverB = buildOAuthServer({
      name: NAME_B,
      slug: SLUG_B,
      id: "mcp-00000000-0000-0000-0000-00000000041b",
    });
    let grantConnectedA = false;
    const connectSpy = vi.fn(() => {
      throw new ConnectError("discovery workflow failed", Code.Internal);
    });

    renderPicker(
      (router) => {
        router.service(McpServerQueryController, {
          getByReference: (input) =>
            input.slug === SLUG_B ? serverB : serverA,
          get: (input) => (input.value === serverB.metadata!.id ? serverB : serverA),
          getOAuthGrantStatus: (input) =>
            grantStatusOutput(
              input.resourceId === serverA.metadata!.id && grantConnectedA,
              input.resourceId === serverA.metadata!.id && grantConnectedA
                ? OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY
                : OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
            ),
        });
        router.service(VaultCommandController, {
          startSignIn: () =>
            create(StartSignInOutputSchema, {
              authorizationUrl: "https://vendor.example/authorize",
              state: "state-1",
            }),
          completeSignIn: () => {
            grantConnectedA = true;
            return create(CompleteSignInOutputSchema, {});
          },
        });
        router.service(McpServerCommandController, {
          connect: connectSpy,
        });
      },
      [serverRef(), serverRef(SLUG_B)],
    );

    // Server A: sign in, discovery fails.
    await drillIntoConfigure(new RegExp(`Configure ${SLUG}$`));
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Sign in with ${SERVER_NAME}`,
      }),
    );
    await screen.findByText(
      /Signed in successfully, but tool discovery failed/,
    );
    expect(openOAuthPopupMock).toHaveBeenCalledTimes(1);

    // Back to the list, drill into server B.
    fireEvent.click(
      screen.getByRole("button", { name: "Back to MCP server list" }),
    );
    await drillIntoConfigure(new RegExp(`Configure ${SLUG_B}`));

    // B must not inherit A's failure: no honest-copy banner, no stranded
    // affordance — a fresh sign-in action.
    await screen.findByRole("button", { name: `Sign in with ${NAME_B}` });
    expect(screen.queryByText(/Signed in successfully/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Discover tools" })).toBeNull();

    // And B's sign-in goes through the popup — proving it did not take
    // A's bare-discovery retry branch.
    fireEvent.click(
      screen.getByRole("button", { name: `Sign in with ${NAME_B}` }),
    );
    await waitFor(() => expect(openOAuthPopupMock).toHaveBeenCalledTimes(2));
  });
});

describe("McpServerPicker — a conversation that leaves My vault out", () => {
  it("saves a sign-in in My vault and reports it to the setup, which the conversation's vaults do not yet satisfy", async () => {
    const started: StartSignInInput[] = [];
    const signedIn = vi.fn();

    renderPicker(
      (router) => {
        router.service(McpServerQueryController, {
          getByReference: () => buildOAuthServer(),
          get: () => buildOAuthServer(),
          getOAuthGrantStatus: () =>
            grantStatusOutput(true, OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY),
        });
        router.service(VaultCommandController, {
          startSignIn: (input) => {
            started.push(input);
            return create(StartSignInOutputSchema, {
              authorizationUrl: "https://vendor.example/authorize",
              state: "state-1",
            });
          },
          completeSignIn: () => create(CompleteSignInOutputSchema, {}),
        });
        router.service(McpServerCommandController, {
          connect: () => buildOAuthServer(),
        });
      },
      [serverRef()],
      { choice: { includeMyVault: false, vaults: [] }, onSignedIn: signedIn },
    );

    await drillIntoConfigure(new RegExp(`Configure ${SLUG}`));
    fireEvent.click(await screen.findByRole("button", { name: `Sign in with ${SERVER_NAME}` }));

    await waitFor(() => expect(signedIn).toHaveBeenCalledTimes(1));
    expect(signedIn).toHaveBeenCalledWith(expect.objectContaining({ slug: SLUG }));
    expect(started[0]?.vault?.vault.case).toBe("mine");
    // The grant is My vault's, which this conversation does not read.
    expect(screen.getByTestId("setup-status").textContent).toBe("needsSetup");
  });
});

describe("McpServerPicker — a key typed into the configure view", () => {
  /** A server that takes one key by name: no sign-in, nothing saved yet. */
  function buildKeyServer(): McpServer {
    const server = buildOAuthServer();
    server.spec!.auth = undefined;
    server.spec!.env = {
      API_KEY: create(EnvVarDeclarationSchema, { isSecret: true, description: "The API key" }),
    };
    return server;
  }

  it("is saved in My vault through the setup, and the conversation that reads My vault is ready", async () => {
    const setSecrets = vi.fn(() => create(VaultSchema, { metadata: { id: "vlt_mine", org: ORG } }));
    renderPicker(
      (router) => {
        router.service(McpServerQueryController, {
          getByReference: () => buildKeyServer(),
          get: () => buildKeyServer(),
          getOAuthGrantStatus: () =>
            grantStatusOutput(false, OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT),
        });
        router.service(VaultCommandController, { setSecrets });
      },
      [serverRef()],
      { choice: { includeMyVault: true, vaults: [] } },
    );

    await drillIntoConfigure(new RegExp(`Configure ${SLUG}`));
    fireEvent.change(await screen.findByLabelText(/^API_KEY/, { selector: "input" }), {
      target: { value: "key-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("setup-status").textContent).toBe("ready"));
  });
});
