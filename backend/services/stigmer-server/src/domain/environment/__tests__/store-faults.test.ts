/**
 * Pins the store-fault contract every environment load by id shares: a typed
 * ResourceNotFoundError answers NotFound with the domain's pinned copy
 * (`environment not found: <id>`), and any other store failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client the environment does not exist
 * (stigmer/stigmer#1345).
 *
 * The surfaces: updateVisibility (its own load step) and the three RPCs that
 * share LoadEnvironmentByID, updateVariables, removeVariables and
 * getSecretValue, each reached through the registered handler on an
 * in-process router. The composed suites reach only a real store, which
 * cannot fail selectively, so each surface runs here against a store whose
 * read throws. The secret service is untouchable: a load that fails must stop
 * the call before any decrypt or encrypt.
 *
 * Out of scope: the NotFound copy itself (wire contract, pinned by
 * environment.test.ts and the environment conformance suite) and the
 * personal-environment resolver's fold of a failed secret read into a
 * missing key (stigmer/stigmer#1360).
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
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

import { registerEnvironmentServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ENVIRONMENT_ID = "env_storefault";

const NOT_FOUND_COPY = `environment not found: ${ENVIRONMENT_ID}`;
const LOAD_FAULT_COPY = "failed to load environment";

const MISSING = (): Error =>
  new ResourceNotFoundError(`environment/${ENVIRONMENT_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

interface EnvironmentClients {
  readonly command: Client<typeof EnvironmentCommandController>;
  readonly query: Client<typeof EnvironmentQueryController>;
}

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind both
 * loads read, then Authorize and ValidateProto run and the load is the first
 * step that reads the store.
 */
function environmentClients(store: Store): EnvironmentClients {
  const transport = createRouterTransport(
    (router) => {
      registerEnvironmentServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        secretService: untouchable("secretService"),
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
  return {
    command: createClient(EnvironmentCommandController, transport),
    query: createClient(EnvironmentQueryController, transport),
  };
}

/** Each surface with an input valid enough to pass ValidateProto. */
const SURFACES: ReadonlyArray<
  readonly [string, (clients: EnvironmentClients) => Promise<unknown>]
> = [
  [
    "updateVisibility — LoadEnvironmentForVisibilityUpdate",
    ({ command }) =>
      command.updateVisibility({
        resourceId: ENVIRONMENT_ID,
        visibility: ApiResourceVisibility.visibility_private,
      }),
  ],
  [
    "updateVariables — LoadEnvironmentByID",
    ({ command }) =>
      command.updateVariables({
        environmentId: ENVIRONMENT_ID,
        variables: { API_KEY: { value: "v", isSecret: false } },
      }),
  ],
  [
    "removeVariables — LoadEnvironmentByID",
    ({ command }) =>
      command.removeVariables({
        environmentId: ENVIRONMENT_ID,
        keys: ["API_KEY"],
      }),
  ],
  [
    "getSecretValue — LoadEnvironmentByID",
    ({ query }) =>
      query.getSecretValue({ environmentId: ENVIRONMENT_ID, key: "API_KEY" }),
  ],
];

describe.each(SURFACES)("%s", (_name, call) => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() => call(environmentClients(store)));
  }

  it("a missing environment answers NotFound with the domain's copy", async () => {
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
