/**
 * Pins the store-fault contract every MCP server load shares: a typed
 * ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`mcp_server not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client the server does not exist (stigmer/stigmer#1345).
 *
 * The surfaces: connect, startConnect (its first load, and the attach arm's
 * re-read after this lane lost the start race), initiateOAuthConnect,
 * completeOAuthConnect, and updateVisibility's load step, reached through the
 * registered handler on an in-process router. completeOAuthConnect loads
 * after the pending state is consumed and the code exchanged, so its fault
 * copy sends the user back through the connect flow. The composed suites
 * reach only a real store, which cannot fail selectively, so each surface
 * runs here against a store whose read throws. Every other dependency is
 * untouchable: a load that fails must stop the call before any of them.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned by the
 * mcpserver conformance suites and the domain's other tests) and the OAuth
 * grant-store reads (stigmer/stigmer#1360).
 */
import { create } from "@bufbuild/protobuf";
import type { ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import {
  CompleteOAuthConnectInputSchema,
  ConnectInputSchema,
  InitiateOAuthConnectInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  failingStore,
  testCallerIdentity,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type {
  PendingOAuthState,
  PendingOAuthStateStore,
  Store,
} from "../../../store/interface.js";

import { completeOAuthConnect } from "../complete-oauth-connect.js";
import type { McpServerConnectDeps } from "../connect.js";
import { connect } from "../connect.js";
import { registerMcpServerServices } from "../controller.js";
import type { ConnectRun, McpServerConnectEngine } from "../engine.js";
import { initiateOAuthConnect } from "../initiate-oauth-connect.js";
import { startConnect } from "../start-connect.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const SERVER_ID = "mcps_storefault";
const ORG = "acme";

const NOT_FOUND_COPY = `mcp_server not found: ${SERVER_ID}`;
const LOAD_FAULT_COPY = "failed to load mcp server";
const CALLBACK_FAULT_COPY =
  "failed to load mcp server — please retry the connect flow";

const MISSING = (): Error =>
  new ResourceNotFoundError(`mcp_server/${SERVER_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/**
 * The connect slice's dependencies with every field untouchable except the
 * ones a surface names: a load that fails must stop the call before the
 * engine, the environments, the grant store or the network.
 */
function connectDeps(
  overrides: Partial<McpServerConnectDeps>,
): McpServerConnectDeps {
  return {
    store: untouchable("store"),
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    engineState: untouchable("engineState"),
    environmentReader: untouchable("environmentReader"),
    executionContext: untouchable("executionContext"),
    runnerAuth: untouchable("runnerAuth"),
    managedEnv: untouchable("managedEnv"),
    oauthGrants: untouchable("oauthGrants"),
    pendingOAuthStates: untouchable("pendingOAuthStates"),
    secretService: untouchable("secretService"),
    oauthRedirectUri: "http://127.0.0.1:8234/auth/oauth/callback",
    outboundFetch: untouchable("outboundFetch"),
    ...overrides,
  };
}

/** A plaintext pending state for SERVER_ID; a keyless SecretService unseals it to itself. */
const PENDING_STATE: PendingOAuthState = {
  state: "state_storefault",
  codeVerifier: "verifier_storefault",
  clientId: "client_storefault",
  clientSecret: "",
  tokenEndpoint: "https://auth.example.test/token",
  mcpServerId: SERVER_ID,
  identityAccountId: "",
  targetEnvVar: "MCP_ACCESS_TOKEN",
  authMethod: "mcp_oauth",
  tokenAuthMethod: "",
  redirectUri: "http://127.0.0.1:8234/auth/oauth/callback",
  org: ORG,
  createdAt: 0,
};

const pendingStates: PendingOAuthStateStore = {
  save: () => Promise.reject(new Error("pendingOAuthStates.save reached")),
  getAndDelete: () => Promise.resolve(PENDING_STATE),
  cleanupExpired: () =>
    Promise.reject(new Error("pendingOAuthStates.cleanupExpired reached")),
};

/** The provider's token endpoint: the exchange succeeds, so the load is next. */
const tokenEndpoint: OutboundFetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ access_token: "at_storefault", token_type: "bearer" }),
      { status: 200 },
    ),
  );

const connectInput = () =>
  create(ConnectInputSchema, { mcpServerId: SERVER_ID, org: ORG });

/**
 * The direct handlers' entry loads. Each validates its input first, so the
 * inputs carry every field the handler requires; completeOAuthConnect also
 * consumes the pending state, unseals it and exchanges the code before its
 * load, so its fakes answer those three steps.
 */
const HANDLER_LOADS: ReadonlyArray<
  readonly [string, string, (store: Store) => Promise<unknown>]
> = [
  [
    "connect",
    LOAD_FAULT_COPY,
    (store) =>
      connect(connectDeps({ store }), connectInput(), testCallerIdentity()),
  ],
  [
    "startConnect — the first load",
    LOAD_FAULT_COPY,
    (store) =>
      startConnect(
        connectDeps({ store }),
        connectInput(),
        testCallerIdentity(),
      ),
  ],
  [
    "initiateOAuthConnect",
    LOAD_FAULT_COPY,
    (store) =>
      initiateOAuthConnect(
        connectDeps({ store }),
        create(InitiateOAuthConnectInputSchema, {
          mcpServerId: SERVER_ID,
          org: ORG,
        }),
        testCallerIdentity(),
      ),
  ],
  [
    "completeOAuthConnect — after the code exchange",
    CALLBACK_FAULT_COPY,
    (store) =>
      completeOAuthConnect(
        connectDeps({
          store,
          pendingOAuthStates: pendingStates,
          secretService: SecretService.create(undefined),
          outboundFetch: tokenEndpoint,
        }),
        create(CompleteOAuthConnectInputSchema, {
          mcpServerId: SERVER_ID,
          state: PENDING_STATE.state,
          authorizationCode: "code_storefault",
        }),
        testCallerIdentity(),
      ),
  ],
];

describe.each(HANDLER_LOADS)("%s", (_surface, faultCopy, run) => {
  it("a missing server answers NotFound with the domain's copy", async () => {
    const error = await errorOf(() => run(failingStore(MISSING())));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NOT_FOUND_COPY);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() => run(failingStore(LOCKED())));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(faultCopy);
  });
});

describe("startConnect — the attach arm's re-read after losing the start race", () => {
  /** No env and no auth block: prepareConnect creates no ExecutionContext and reads no grant. */
  const SERVER = create(McpServerSchema, {
    metadata: { id: SERVER_ID, name: "Store Fault", org: ORG },
    spec: {
      serverType: { case: "stdio", value: { command: "npx", args: [] } },
    },
  });

  async function attachError(reReadError: Error): Promise<ConnectError> {
    const attached: ConnectRun = {
      workflowId: `stigmer/mcp-server/connect/${SERVER_ID}`,
      attached: true,
      result: () =>
        Promise.reject(new Error("result reached on the attach arm")),
    };
    const startOrAttachConnect = vi.fn<
      McpServerConnectEngine["startOrAttachConnect"]
    >(() => Promise.resolve(attached));
    const engine: McpServerConnectEngine = {
      startOrAttachConnect,
      isConnectRunRunning: () =>
        Promise.reject(
          new Error("isConnectRunRunning reached without a CONNECTING record"),
        ),
      hasRunnerQueuePollers: () => Promise.resolve(true),
    };
    const getResource = vi
      .fn()
      .mockResolvedValueOnce(SERVER)
      .mockRejectedValueOnce(reReadError);

    const error = await errorOf(() =>
      startConnect(
        connectDeps({
          store: { getResource } as unknown as Store,
          engineState: () => ({ connected: true, engine }),
        }),
        connectInput(),
        testCallerIdentity(),
      ),
    );

    // The start ran once and the store was read twice: the failure is the
    // re-read's, not the first load's.
    expect(startOrAttachConnect).toHaveBeenCalledTimes(1);
    expect(getResource).toHaveBeenCalledTimes(2);
    return error;
  }

  it("a server deleted since the first load answers NotFound with the domain's copy", async () => {
    const error = await attachError(MISSING());

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NOT_FOUND_COPY);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await attachError(LOCKED());

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

describe("updateVisibility — LoadMcpServerForVisibilityUpdate", () => {
  /**
   * The registered handler on an in-process router (the artifact domain's
   * harness): the verifier chain stamps the trusted-local caller and the
   * apiresource interceptor the kind, then Authorize and ValidateProto run
   * and the load is the first step that reads the store. The connect slice
   * is never reached.
   */
  function updateVisibilityError(store: Store): Promise<ConnectError> {
    const transport = createRouterTransport(
      (router) => {
        registerMcpServerServices(router, {
          store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          authorizationLifecycle: undefined,
          connect: untouchable("connect"),
        });
      },
      {
        router: {
          interceptors: [
            createVerifierChainInterceptor([], [], silentLogger),
            createApiResourceInterceptor(),
          ],
        },
      },
    );
    const command = createClient(McpServerCommandController, transport);
    return errorOf(() =>
      command.updateVisibility({
        resourceId: SERVER_ID,
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );
  }

  it("a missing server answers NotFound with the domain's copy", async () => {
    const error = await updateVisibilityError(failingStore(MISSING()));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NOT_FOUND_COPY);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await updateVisibilityError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});
