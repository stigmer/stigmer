/**
 * Pins the store-fault contract every credential load by id shares: a typed
 * ResourceNotFoundError answers NotFound with the domain's copy
 * (`credential not found: <id>`; the shared get and delete loads speak the
 * kind's registry name, `Credential not found: <id>`), and any other store
 * failure is an
 * infrastructure fault answered as a sanitized Internal, never a NotFound
 * that tells a client the credential does not exist (stigmer/stigmer#1345).
 * The list lane's organization read takes the same fault doctrine: a failed
 * read is Internal, never an empty list.
 *
 * The surfaces: the three RPCs that share LoadCredentialById (setFields,
 * removeFields, revealField), the shared get and delete loads, and list,
 * each reached through the registered handler on an in-process router. The
 * composed suite (credential.test.ts) reaches only a real store, which
 * cannot fail selectively, so each surface runs here against a store whose
 * read throws. The secret service is untouchable: a load that fails must
 * stop the call before any decrypt or encrypt.
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialQueryController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/query_pb";

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

import { registerCredentialServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const CREDENTIAL_ID = "cred_storefault";

const NOT_FOUND_COPY = `credential not found: ${CREDENTIAL_ID}`;
/** The shared load steps name the kind as the registry spells it. */
const SHARED_NOT_FOUND_COPY = `Credential not found: ${CREDENTIAL_ID}`;

const MISSING = (): Error =>
  new ResourceNotFoundError(`credential/${CREDENTIAL_ID}`);
const LOCKED = (): Error => new Error("SQLITE_BUSY: database is locked");

interface CredentialClients {
  readonly command: Client<typeof CredentialCommandController>;
  readonly query: Client<typeof CredentialQueryController>;
}

/**
 * The registered handlers on an in-process router: the verifier chain stamps
 * the trusted-local caller and the apiresource interceptor the kind every
 * load reads, then Authorize and ValidateProto run and the load is the first
 * step that reads the store.
 */
function credentialClients(store: Store): CredentialClients {
  const transport = createRouterTransport(
    (router) => {
      registerCredentialServices(router, {
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
    command: createClient(CredentialCommandController, transport),
    query: createClient(CredentialQueryController, transport),
  };
}

/** Each load-by-id surface, with an input valid enough to pass ValidateProto, and its fault copy. */
const SURFACES: ReadonlyArray<
  readonly [string, string, (clients: CredentialClients) => Promise<unknown>]
> = [
  [
    "setFields — LoadCredentialById",
    "failed to load credential",
    ({ command }) =>
      command.setFields({
        credentialId: CREDENTIAL_ID,
        fields: { API_KEY: { value: "v", plain: true } },
      }),
  ],
  [
    "removeFields — LoadCredentialById",
    "failed to load credential",
    ({ command }) =>
      command.removeFields({
        credentialId: CREDENTIAL_ID,
        fields: ["API_KEY"],
      }),
  ],
  [
    "revealField — LoadCredentialById",
    "failed to load credential",
    ({ query }) =>
      query.revealField({ credentialId: CREDENTIAL_ID, field: "API_KEY" }),
  ],
];

describe.each(SURFACES)("%s", (_name, faultCopy, call) => {
  function surfaceError(store: Store): Promise<ConnectError> {
    return errorOf(() => call(credentialClients(store)));
  }

  it("a missing credential answers NotFound with the domain's copy", async () => {
    const error = await surfaceError(failingStore(MISSING()));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NOT_FOUND_COPY);
  });

  it("any other store failure answers a sanitized Internal", async () => {
    const error = await surfaceError(failingStore(LOCKED()));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(faultCopy);
  });
});

describe("the shared loads (get, delete)", () => {
  it("get answers NotFound for a missing credential and Internal for a fault", async () => {
    const missing = await errorOf(() =>
      credentialClients(failingStore(MISSING())).query.get({
        value: CREDENTIAL_ID,
      }),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(SHARED_NOT_FOUND_COPY);

    const locked = await errorOf(() =>
      credentialClients(failingStore(LOCKED())).query.get({
        value: CREDENTIAL_ID,
      }),
    );
    expect(locked.code).toBe(Code.Internal);
    expect(locked.rawMessage).not.toContain("SQLITE_BUSY");
  });

  it("delete answers NotFound for a missing credential and Internal for a fault", async () => {
    const missing = await errorOf(() =>
      credentialClients(failingStore(MISSING())).command.delete({
        resourceId: CREDENTIAL_ID,
      }),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(SHARED_NOT_FOUND_COPY);

    const locked = await errorOf(() =>
      credentialClients(failingStore(LOCKED())).command.delete({
        resourceId: CREDENTIAL_ID,
      }),
    );
    expect(locked.code).toBe(Code.Internal);
    expect(locked.rawMessage).not.toContain("SQLITE_BUSY");
  });
});

describe("list — the organization's credentials through the list index", () => {
  it("a failed read answers a sanitized Internal, never an empty list", async () => {
    const store = {
      queryResources: () => Promise.reject(LOCKED()),
    } as unknown as Store;
    const error = await errorOf(() =>
      credentialClients(store).query.list({ org: "acme" }),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to list credentials");
  });
});
