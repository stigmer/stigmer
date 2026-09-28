/**
 * Pins the store-fault contract of the workflow instance's loads. The shared
 * targeted-update load (updateVisibility and updateExecutionVisibility): a
 * typed ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`workflow instance not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound that
 * tells a client the instance does not exist (stigmer/stigmer#1345). Create's
 * parent-workflow load reads the workflow through the in-process query
 * client, so the store's typed miss arrives as a Connect NotFound: that
 * answers the pinned `Workflow not found: <id>`, and any other failure an
 * Internal, never a missing parent (stigmer/stigmer#1351).
 *
 * Every surface is reached through the registered handler on an in-process
 * router. The composed suites reach only a real store, which cannot fail
 * selectively, so the updates run against a store whose read throws and
 * create against a parent loader whose read throws. Whatever the surface does
 * not need is untouchable: a load that fails must stop the call before
 * anything past it runs.
 *
 * Out of scope: the NotFound copies themselves (wire contract).
 */
import type { Client } from "@connectrpc/connect";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import {
  errorOf,
  failingStore,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { INTERNAL_FALLBACK_MESSAGE } from "../../../pipeline/pipeline.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { registerWorkflowInstanceServices } from "../controller.js";
import type { ParentWorkflowLoaderProvider } from "../steps.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const INSTANCE_ID = "win_storefault";
const WORKFLOW_ID = "wfl_storefault";

const NOT_FOUND_COPY = `workflow instance not found: ${INSTANCE_ID}`;
const LOAD_FAULT_COPY = "failed to load workflow instance";
const PARENT_NOT_FOUND_COPY = `Workflow not found: ${WORKFLOW_ID}`;
const PARENT_LOAD_FAULT_COPY = "failed to load parent workflow";

const MISSING = (): Error =>
  new ResourceNotFoundError(`workflow_instance/${INSTANCE_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

/** What the workflow query's `get` answers for a missing and a faulted workflow. */
const PARENT_MISSING = (): Error =>
  new ConnectError(`Workflow not found: ${WORKFLOW_ID}`, Code.NotFound);
const PARENT_FAULTED = (): Error =>
  new ConnectError(INTERNAL_FALLBACK_MESSAGE, Code.Internal);

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind, then
 * Authorize and ValidateProto run and the load is the first step that reads
 * the store or the parent.
 */
function instanceCommand(
  store: Store,
  parentWorkflowLoader: ParentWorkflowLoaderProvider = untouchable(
    "parentWorkflowLoader",
  ),
): Client<typeof WorkflowInstanceCommandController> {
  const transport = createRouterTransport(
    (router) => {
      registerWorkflowInstanceServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        parentWorkflowLoader,
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
  return createClient(WorkflowInstanceCommandController, transport);
}

describe.each([
  {
    surface: "updateVisibility — LoadInstanceForVisibilityUpdate",
    call: (store: Store) =>
      instanceCommand(store).updateVisibility({
        resourceId: INSTANCE_ID,
        visibility: ApiResourceVisibility.visibility_private,
      }),
  },
  {
    surface:
      "updateExecutionVisibility — LoadInstanceForExecutionVisibilityUpdate",
    call: (store: Store) =>
      instanceCommand(store).updateExecutionVisibility({
        resourceId: INSTANCE_ID,
        executionVisibility: WorkflowExecutionVisibility.private,
      }),
  },
])("$surface", ({ call }) => {
  it("a missing workflow instance answers NotFound with the domain's copy", async () => {
    const error = await errorOf(() => call(failingStore(MISSING())));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NOT_FOUND_COPY);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await errorOf(() => call(failingStore(LOCKED())));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(LOAD_FAULT_COPY);
  });
});

describe("create — LoadParentWorkflow", () => {
  function surfaceError(parentError: Error): Promise<ConnectError> {
    const failingParent: ParentWorkflowLoaderProvider = () => ({
      get: () => Promise.reject(parentError),
    });
    return errorOf(() =>
      instanceCommand(untouchable("store"), failingParent).create({
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "WorkflowInstance",
        metadata: { name: "Store Fault Instance", org: "org_storefault" },
        spec: { workflowId: WORKFLOW_ID },
      }),
    );
  }

  it("a missing parent workflow answers NotFound with the pinned copy", async () => {
    const error = await surfaceError(PARENT_MISSING());

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(PARENT_NOT_FOUND_COPY);
  });

  it("any other parent-load failure answers a sanitized Internal", async () => {
    const error = await surfaceError(PARENT_FAULTED());

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(PARENT_LOAD_FAULT_COPY);
  });
});
