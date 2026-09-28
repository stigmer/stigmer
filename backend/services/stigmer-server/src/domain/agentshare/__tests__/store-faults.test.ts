/**
 * Pins the store-fault contract of the share's link-rotation load: a typed
 * ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`AgentShare not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client the share does not exist (stigmer/stigmer#1345).
 * Rotation is how an owner kills a leaked link, so a fault that reads as a
 * missing share would leave the link live behind a false answer.
 *
 * The surface is rotateShareLink, reached through the registered handler on
 * an in-process router. The composed suites reach only a real store, which
 * cannot fail selectively, so it runs here against a store whose read throws.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned by the
 * agentshare conformance suite), the anonymous profile lanes' deliberate
 * uniform NotFound, and getByAgent's empty-list answer on an agent-read
 * fault (stigmer/stigmer#1375).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";

import { createLogger } from "../../../boot/logger.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import { errorOf, failingStore } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { registerAgentShareServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const SHARE_ID = "ash_storefault";

const NOT_FOUND_COPY = `AgentShare not found: ${SHARE_ID}`;
const LOAD_FAULT_COPY = "failed to load agent share";

const MISSING = (): Error =>
  new ResourceNotFoundError(`agent_share/${SHARE_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind the load
 * reads, then Authorize and ValidateProto run and the load is the first step
 * that reads the store.
 */
function shareCommand(
  store: Store,
): Client<typeof AgentShareCommandController> {
  const transport = createRouterTransport(
    (router) => {
      registerAgentShareServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
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
  return createClient(AgentShareCommandController, transport);
}

describe("rotateShareLink — LoadShareForLinkRotation", () => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      shareCommand(store).rotateShareLink({ resourceId: SHARE_ID }),
    );
  }

  it("a missing share answers NotFound with the domain's copy", async () => {
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
