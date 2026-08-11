import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import {
  OAuthConnectionHealth,
  GetOAuthGrantStatusOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import {
  McpServerSpecSchema,
  McpServerAuthSchema,
  HttpServerConfigSchema,
  ToolApprovalPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  McpServerStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredToolSchema,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { McpServerDetailView } from "../McpServerDetailView";
import type { UseMcpServerReturn } from "../useMcpServer";

beforeAll(() => {
  // happy-dom lacks ResizeObserver, which Base UI positioners observe.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

const ORG = "acme";
const SLUG = "order-management-api";

/** Frozen discovery instant — fixtures must never read the real clock. */
const DISCOVERED_AT = new Date("2026-07-20T09:30:00Z");

/** The server as registered: HTTP transport, one secret env var, no tools. */
function buildBaseServer(): McpServer {
  const server = samples.mcpServer({ name: "Order Management API", org: ORG, slug: SLUG });
  server.spec = create(McpServerSpecSchema, {
    description: "REST API for order lookup, inventory, and return processing.",
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://api.acme.com/mcp" }),
    },
    env: {
      API_TOKEN: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "Bearer token for the Order Management API",
      }),
    },
  });
  return server;
}

/** The same server after Connect: 3 discovered tools, 1 classified policy. */
function buildConnectedServer(): McpServer {
  const server = buildBaseServer();
  server.status = create(McpServerStatusSchema, {
    validationState: ValidationState.valid,
    discoveredCapabilities: create(DiscoveredCapabilitiesSchema, {
      lastDiscoveredAt: timestampFromDate(DISCOVERED_AT),
      tools: [
        create(DiscoveredToolSchema, { name: "get_order", description: "Retrieve one order by ID." }),
        create(DiscoveredToolSchema, { name: "list_orders", description: "List recent orders." }),
        create(DiscoveredToolSchema, { name: "process_return", description: "Initiate a return and refund." }),
      ],
    }),
    toolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "process_return",
        message: "Process return for order '{{args.order_id}}'",
      }),
    ],
  });
  return server;
}

/** The same server as an OAuth integration (target var declared in env). */
function buildOAuthServer(): McpServer {
  const server = buildBaseServer();
  server.spec!.auth = create(McpServerAuthSchema, {
    targetEnvVar: "API_TOKEN",
    oauthOnly: true,
  });
  return server;
}

/**
 * Grant-status fixture for the given health. `connected: true` reflects the
 * two-act persistence contract: completeOAuthConnect stores the grant before
 * the chained discovery runs, so a grant can exist with zero discovered tools.
 */
function grantStatus(health: OAuthConnectionHealth) {
  return () =>
    create(GetOAuthGrantStatusOutputSchema, {
      connected: true,
      connectionHealth: health,
      targetEnvVar: "API_TOKEN",
      authMethod: "mcp_oauth",
    });
}

/** Hoisted-state bag in its settled, data-loaded shape. */
function loadedState(server: McpServer): UseMcpServerReturn {
  return { mcpServer: server, isLoading: false, isRefetching: false, error: null, refetch: vi.fn() };
}

/**
 * Mounts the view against a real Connect router transport. RPCs the test
 * does not register fall through to Connect's `unimplemented`, which the
 * SDK hooks degrade from — the same contract the tours rely on.
 */
function renderView(
  ui: ReactNode,
  register: Parameters<typeof createRouterTransport>[0] = () => {},
) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
  return render(
    <StigmerContext.Provider value={client}>{ui}</StigmerContext.Provider>,
  );
}

describe("McpServerDetailView — hoisted mcpServerState", () => {
  it("renders from injected state without issuing getByReference", async () => {
    const getByReference = vi.fn(() => {
      throw new ConnectError("must not fetch", Code.FailedPrecondition);
    });

    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildBaseServer())}
      />,
      (router) => {
        router.service(McpServerQueryController, { getByReference });
      },
    );

    // Content is on screen synchronously — no skeleton frame first.
    expect(
      screen.getByRole("heading", { name: "Order Management API" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Loading MCP server details")).toBeNull();

    // Let pending microtasks (credentials/permission fetches) settle, then
    // confirm the resource fetch never fired.
    await screen.findByRole("tab", { name: /Tools/ });
    expect(getByReference).not.toHaveBeenCalled();
  });

  it("shows the loading skeleton while the injected state is loading", () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={{
          mcpServer: null,
          isLoading: true,
          isRefetching: false,
          error: null,
          refetch: vi.fn(),
        }}
      />,
    );
    expect(screen.getByLabelText("Loading MCP server details")).toBeTruthy();
    // A loading owner must never read as a missing resource.
    expect(screen.queryByText("MCP Server not found")).toBeNull();
  });

  it("routes the error state's Retry to the injected refetch", () => {
    const refetch = vi.fn();
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={{
          mcpServer: null,
          isLoading: false,
          isRefetching: false,
          error: new ConnectError("backend down", Code.Unavailable),
          refetch,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders not-found when the injected state settles with no resource", () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={{
          mcpServer: null,
          isLoading: false,
          isRefetching: false,
          error: null,
          refetch: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText("MCP Server not found")).toBeTruthy();
  });
});

describe("McpServerDetailView — self-fetching mode (unchanged behaviour)", () => {
  it("fetches by org/slug and renders the resolved server", async () => {
    const getByReference = vi.fn(() => buildBaseServer());
    renderView(<McpServerDetailView org={ORG} slug={SLUG} />, (router) => {
      router.service(McpServerQueryController, { getByReference });
    });

    // First paint is the skeleton; content follows the fetch.
    expect(screen.getByLabelText("Loading MCP server details")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "Order Management API" }),
    ).toBeTruthy();
    expect(getByReference).toHaveBeenCalledTimes(1);
  });

  it("renders not-found when the fetch 404s", async () => {
    renderView(<McpServerDetailView org={ORG} slug={SLUG} />, (router) => {
      router.service(McpServerQueryController, {
        getByReference: () => {
          throw new ConnectError("no such server", Code.NotFound);
        },
      });
    });
    expect(await screen.findByText("MCP Server not found")).toBeTruthy();
  });
});

describe("McpServerDetailView — connect bar and capability tabs", () => {
  it("offers Connect with the not-connected status before discovery", () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildBaseServer())}
      />,
    );
    expect(screen.getByRole("button", { name: /^Connect$/ })).toBeTruthy();
    expect(screen.getByText("Not connected yet")).toBeTruthy();
    expect(
      screen.getByText("Connect to this MCP server to discover its available tools."),
    ).toBeTruthy();
  });

  it("offers Reconnect with the connected status and discovery date after discovery", () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildConnectedServer())}
      />,
    );
    expect(screen.getByRole("button", { name: /Reconnect/ })).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Valid")).toBeTruthy();
    expect(screen.getByText(/Discovered/)).toBeTruthy();
  });

  it("lists the discovered tools with the count badge", () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildConnectedServer())}
      />,
    );
    const toolsTab = screen.getByRole("tab", { name: /Tools/ });
    expect(toolsTab.textContent).toContain("3");
    expect(screen.getByText("get_order")).toBeTruthy();
    expect(screen.getByText("list_orders")).toBeTruthy();
    expect(screen.getByText("process_return")).toBeTruthy();
  });

  it("groups the classified policy under Auto-classified with a badge of 1, not 3", () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        defaultCapabilityTab="policies"
        mcpServerState={loadedState(buildConnectedServer())}
      />,
    );
    const policiesTab = screen.getByRole("tab", { name: /Policies/ });
    expect(policiesTab.textContent).toContain("1");
    expect(policiesTab.textContent).not.toContain("3");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/Auto-classified/)).toBeTruthy();
    expect(within(panel).getByText("process_return")).toBeTruthy();
    expect(within(panel).getByText("requires approval")).toBeTruthy();
  });
});

describe("McpServerDetailView — signed in but undiscovered (oss#229)", () => {
  it("renders the stranded state: honest status text, Discover tools action, recovery empty state", async () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildOAuthServer())}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: grantStatus(
            OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
          ),
        });
      },
    );

    // The grant is healthy, so the pill honestly reads Connected — but the
    // status text must carry the tools gap, not "tokens refresh automatically".
    expect(
      await screen.findByText("Signed in \u2014 tools not discovered yet"),
    ).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    // One action in the connect bar, one in the Tools tab empty state.
    expect(
      screen.getAllByRole("button", { name: /^Discover tools$/ }),
    ).toHaveLength(2);

    // The Tools tab empty state carries its own recovery action instead of
    // the dead-end "Connect to this MCP server..." copy.
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByText("Signed in, but tools haven't been discovered yet."),
    ).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: /^Discover tools$/ }),
    ).toBeTruthy();
    expect(
      within(panel).queryByText(
        "Connect to this MCP server to discover its available tools.",
      ),
    ).toBeNull();
  });

  it("runs bare discovery from the Tools tab action — never the OAuth popup", async () => {
    const connect = vi.fn(() => buildConnectedServer());
    const initiateOAuthConnect = vi.fn(() => {
      throw new ConnectError("must not relaunch OAuth", Code.FailedPrecondition);
    });

    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildOAuthServer())}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: grantStatus(
            OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
          ),
        });
        router.service(McpServerCommandController, {
          connect,
          initiateOAuthConnect,
        });
      },
    );

    const panel = screen.getByRole("tabpanel");
    const discover = await within(panel).findByRole("button", {
      name: /^Discover tools$/,
    });
    fireEvent.click(discover);

    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(initiateOAuthConnect).not.toHaveBeenCalled();
  });

  it("adjusts the Policies tab empty copy in the stranded state", async () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        defaultCapabilityTab="policies"
        mcpServerState={loadedState(buildOAuthServer())}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: grantStatus(
            OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
          ),
        });
      },
    );

    expect(
      await screen.findByText(
        "Signed in \u2014 discover tools to auto-classify approval policies.",
      ),
    ).toBeTruthy();
  });

  it("keeps re-auth ahead of discovery when the token is expired", async () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildOAuthServer())}
      />,
      (router) => {
        router.service(McpServerQueryController, {
          getOAuthGrantStatus: grantStatus(
            OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED,
          ),
        });
      },
    );

    // An expired grant with no tools needs a fresh sign-in first —
    // discovery would fail against a dead token anyway.
    expect(
      await screen.findByRole("button", { name: /Sign in to connect/ }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Discover tools$/ }),
    ).toBeNull();
  });
});

describe("McpServerDetailView — tour scroll anchors", () => {
  it("marks the Connection and Capabilities sections as scroll targets", () => {
    const { container } = renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildBaseServer())}
      />,
    );
    expect(
      container.querySelector('[data-scroll-target="mcp-connection"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-scroll-target="mcp-capabilities"]'),
    ).toBeTruthy();
  });
});

describe("McpServerDetailView — credential form gating", () => {
  it("opens the credential form for the declared missing variable when asked", async () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        defaultShowCredentialForm
        mcpServerState={loadedState(buildBaseServer())}
      />,
    );
    expect(await screen.findByText("Credentials Required")).toBeTruthy();
    // Scope to the credential form — the Environment section also lists
    // API_TOKEN as a declaration.
    const form = screen.getByRole("form", {
      name: /Configure Credentials Required/i,
    });
    // Anchored: the secret input's reveal button is labelled "Show API_TOKEN".
    expect(within(form).getByLabelText(/^API_TOKEN/)).toBeTruthy();
  });

  it("keeps the form closed by default", () => {
    renderView(
      <McpServerDetailView
        org={ORG}
        slug={SLUG}
        mcpServerState={loadedState(buildBaseServer())}
      />,
    );
    expect(screen.queryByText("Credentials Required")).toBeNull();
  });
});
