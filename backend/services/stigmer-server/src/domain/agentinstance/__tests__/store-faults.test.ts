/**
 * Pins the store-fault contract of the agent instance's visibility-update
 * load: a typed ResourceNotFoundError answers NotFound with the domain's
 * pinned copy (`agent instance not found: <id>`), and any other store failure
 * is an infrastructure fault answered as a sanitized Internal, never a
 * NotFound that tells a client the instance does not exist
 * (stigmer/stigmer#1345).
 *
 * The surface is updateVisibility, reached through the registered handler on
 * an in-process router. The composed suites reach only a real store, which
 * cannot fail selectively, so it runs here against a store whose read throws.
 * The parent-agent loader is untouchable: a load that fails must stop the
 * call before anything past it runs.
 *
 * Out of scope: the NotFound copy itself (wire contract) and create's
 * parent-agent load, which folds every RPC error into NotFound
 * (stigmer/stigmer#1351).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  failingStore,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { registerAgentInstanceServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const INSTANCE_ID = "ain_storefault";

const NOT_FOUND_COPY = `agent instance not found: ${INSTANCE_ID}`;
const LOAD_FAULT_COPY = "failed to load agent instance";

const MISSING = (): Error =>
  new ResourceNotFoundError(`agent_instance/${INSTANCE_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind, then
 * Authorize and ValidateProto run and the load is the first step that reads
 * the store.
 */
function instanceCommand(
  store: Store,
): Client<typeof AgentInstanceCommandController> {
  const transport = createRouterTransport(
    (router) => {
      registerAgentInstanceServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        parentAgentLoader: untouchable("parentAgentLoader"),
        listReadScope: undefined,
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
  return createClient(AgentInstanceCommandController, transport);
}

describe("updateVisibility — LoadInstanceForVisibilityUpdate", () => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      instanceCommand(store).updateVisibility({
        resourceId: INSTANCE_ID,
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );
  }

  it("a missing agent instance answers NotFound with the domain's copy", async () => {
    const error = await surfaceError(failingStore(MISSING()));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NOT_FOUND_COPY);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await surfaceError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});
