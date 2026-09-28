/**
 * Pins the store-fault contract of the agent's visibility-update load: a
 * typed ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`agent not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client the agent does not exist (stigmer/stigmer#1345).
 *
 * The surface is updateVisibility, reached through the registered handler on
 * an in-process router. The composed suites reach only a real store, which
 * cannot fail selectively, so it runs here against a store whose read throws.
 * The default-instance applier is untouchable: a load that fails must stop
 * the call before anything past it runs.
 *
 * Out of scope: the NotFound copy itself (wire contract) and getByAgent's
 * empty-list answer on an agent-read fault in the channel and share domains
 * (stigmer/stigmer#1375).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
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

import { registerAgentServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const AGENT_ID = "agt_storefault";

const NOT_FOUND_COPY = `agent not found: ${AGENT_ID}`;
const LOAD_FAULT_COPY = "failed to load agent";

const MISSING = (): Error => new ResourceNotFoundError(`agent/${AGENT_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind, then
 * Authorize and ValidateProto run and the load is the first step that reads
 * the store.
 */
function agentCommand(store: Store): Client<typeof AgentCommandController> {
  const transport = createRouterTransport(
    (router) => {
      registerAgentServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        agentInstanceApplier: untouchable("agentInstanceApplier"),
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
  return createClient(AgentCommandController, transport);
}

describe("updateVisibility — LoadAgentForVisibilityUpdate", () => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      agentCommand(store).updateVisibility({
        resourceId: AGENT_ID,
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );
  }

  it("a missing agent answers NotFound with the domain's copy", async () => {
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
