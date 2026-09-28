/**
 * Pins the store-fault contract of the workflow's visibility-update load: a
 * typed ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`workflow not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound that
 * tells a client the workflow does not exist (stigmer/stigmer#1345).
 *
 * The surface is updateVisibility, reached through the registered handler on
 * an in-process router. The composed suites reach only a real store, which
 * cannot fail selectively, so it runs here against a store whose read throws.
 * The validator and the default-instance creator are untouchable: a load that
 * fails must stop the call before anything past it runs.
 *
 * Out of scope: the NotFound copy itself (wire contract).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
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

import { registerWorkflowServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const WORKFLOW_ID = "wfl_storefault";

const NOT_FOUND_COPY = `workflow not found: ${WORKFLOW_ID}`;
const LOAD_FAULT_COPY = "failed to load workflow";

const MISSING = (): Error =>
  new ResourceNotFoundError(`workflow/${WORKFLOW_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind, then
 * Authorize and ValidateProto run and the load is the first step that reads
 * the store.
 */
function workflowCommand(
  store: Store,
): Client<typeof WorkflowCommandController> {
  const transport = createRouterTransport(
    (router) => {
      registerWorkflowServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        validator: untouchable("validator"),
        workflowInstanceCreator: untouchable("workflowInstanceCreator"),
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
  return createClient(WorkflowCommandController, transport);
}

describe("updateVisibility — LoadWorkflowForVisibilityUpdate", () => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() =>
      workflowCommand(store).updateVisibility({
        resourceId: WORKFLOW_ID,
        visibility: ApiResourceVisibility.visibility_private,
      }),
    );
  }

  it("a missing workflow answers NotFound with the domain's copy", async () => {
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
