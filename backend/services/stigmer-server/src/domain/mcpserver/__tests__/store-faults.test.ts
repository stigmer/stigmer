/**
 * Pins the store-fault contract every MCP server load shares: a typed
 * ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`mcp_server not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client the server does not exist (stigmer/stigmer#1345).
 *
 * The surfaces: connect, startConnect (its first load, and the attach arm's
 * re-read after this lane lost the start race), and updateVisibility's load
 * step, reached through the registered handler on an in-process router.
 * The composed suites
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

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { createLogger } from "../../../boot/logger.js";
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
import type { Store } from "../../../store/interface.js";

import type { McpServerConnectDeps } from "../connect.js";
import { connect } from "../connect.js";
import { registerMcpServerServices } from "../controller.js";
import type { ConnectRun, McpServerConnectEngine } from "../engine.js";
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

const MISSING = (): Error =>
  new ResourceNotFoundError(`mcp_server/${SERVER_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/**
 * The connect slice's dependencies with every field untouchable except the
 * ones a surface names: a load that fails must stop the call before the
 * engine, the vaults or the network.
 */
function connectDeps(
  overrides: Partial<McpServerConnectDeps>,
): McpServerConnectDeps {
  return {
    store: untouchable("store"),
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    engineState: untouchable("engineState"),
    runnerAuth: untouchable("runnerAuth"),
    vaults: untouchable("vaults"),
    vaultResolver: untouchable("vaultResolver"),
    // The external-runner posture: no connect sandbox is provisioned.
    sandboxLane: { enabled: false },
    outboundFetch: untouchable("outboundFetch"),
    ...overrides,
  };
}

const connectInput = () =>
  create(ConnectInputSchema, { mcpServerId: SERVER_ID, org: ORG });

/**
 * The direct handlers' entry loads. Each validates its input first, so the
 * inputs carry every field the handler requires.
 */
const HANDLER_LOADS: ReadonlyArray<
  readonly [string, string, (store: Store) => Promise<unknown>]
> = [
  [
    "connect",
    LOAD_FAULT_COPY,
    (store) =>
      connect(connectDeps({ store }), connectInput(), testCallerIdentity(), ""),
  ],
  [
    "startConnect — the first load",
    LOAD_FAULT_COPY,
    (store) =>
      startConnect(
        connectDeps({ store }),
        connectInput(),
        testCallerIdentity(),
        "",
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
  /** No env and no auth block: prepareConnect plans nothing and mints no credential; it records the attempt. */
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

    // The attempt the lane records and ends around the start; its own
    // rows are pinned in connect.test.ts.
    const connectAttempts: Store["connectAttempts"] = {
      create: () => Promise.resolve(),
      findLive: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(),
      deleteExpired: () => Promise.resolve(0),
      deleteByOrg: () => Promise.resolve(0),
    };
    const error = await errorOf(() =>
      startConnect(
        connectDeps({
          store: { getResource, connectAttempts } as unknown as Store,
          engineState: () => ({ connected: true, engine }),
        }),
        connectInput(),
        testCallerIdentity(),
        "",
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
   * The registered handler on an in-process router: the verifier chain stamps the trusted-local caller and the
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
