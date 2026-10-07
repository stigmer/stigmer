/**
 * Pins how the sign-in lanes take a failure in the credential seam and
 * the grant store, at the handlers (completeOAuthConnect,
 * disconnectOAuth), with every other dependency a fake that answers the
 * happy path. The composed handshake suite (oauth-handshake.test.ts) runs
 * over a real store that cannot fail selectively.
 *
 * completeOAuthConnect, after the code is exchanged:
 *   - an existing grant that cannot be looked up is logged, and the sign-in
 *     is saved into a new credential rather than lost;
 *   - a refusal from the credential pipeline (a second sign-in serving the
 *     same server) reaches the caller as the pipeline spoke it; any other
 *     failure saving the token is a sanitized Internal;
 *   - a refresh token that cannot be sealed is Internal, and no grant is
 *     written holding it plaintext.
 *
 * disconnectOAuth: a sign-in credential that cannot be deleted is
 * Internal, and the grant is kept, so the sign-in is never half-ended.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  CompleteOAuthConnectInputSchema,
  DisconnectOAuthInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import {
  errorOf,
  testCallerIdentity,
  untouchable,
} from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type {
  OAuthGrant,
  OAuthGrantStore,
  PendingOAuthState,
  PendingOAuthStateStore,
  Store,
} from "../../../store/interface.js";
import type { SignInCredentialClient } from "../../credential/sign-in.js";
import { SignInCredentials } from "../../credential/sign-in.js";

import { completeOAuthConnect } from "../complete-oauth-connect.js";
import type { McpServerConnectDeps } from "../connect.js";
import { disconnectOAuth } from "../disconnect-oauth.js";

const SERVER_ID = "mcps_signin";
const ORG = "acme";
const CALLER = testCallerIdentity();

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const SERVER = create(McpServerSchema, {
  metadata: { id: SERVER_ID, org: ORG, slug: "signin", name: "Sign In" },
  spec: { auth: { targetEnvVar: "SIGNIN_TOKEN" } },
});

/** A plaintext pending personal sign-in the caller started; a keyless or keyed SecretService unseals it to itself. */
const PENDING: PendingOAuthState = {
  state: "state_signin",
  codeVerifier: "verifier_signin",
  clientId: "client_signin",
  clientSecret: "",
  tokenEndpoint: "https://auth.example.test/token",
  mcpServerId: SERVER_ID,
  identityAccountId: CALLER.identityId,
  targetEnvVar: "SIGNIN_TOKEN",
  authMethod: "mcp_oauth",
  tokenAuthMethod: "",
  redirectUri: "http://127.0.0.1:8234/auth/oauth/callback",
  org: ORG,
  createdAt: 0,
};

const pendingStates: PendingOAuthStateStore = {
  save: () => Promise.reject(new Error("pendingOAuthStates.save reached")),
  getAndDelete: () => Promise.resolve(PENDING),
  cleanupExpired: () => Promise.reject(new Error("cleanupExpired reached")),
  deleteByOrg: () => Promise.reject(new Error("deleteByOrg reached")),
};

const tokenEndpoint: OutboundFetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        access_token: "at_signin",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "rt_signin",
      }),
      { status: 200 },
    ),
  );

/** The server is there; the credential is there only when `credentialHeld` says so. */
function storeWith(credentialHeld: boolean): Store {
  return {
    getResource: (kind: ApiResourceKind) => {
      if (kind === ApiResourceKind.mcp_server) {
        return Promise.resolve(SERVER);
      }
      return credentialHeld
        ? Promise.resolve(
            create(CredentialSchema, { metadata: { id: "cred_held" } }),
          )
        : Promise.reject(new ResourceNotFoundError("credential/cred_held"));
    },
  } as unknown as Store;
}

interface GrantRecorder {
  readonly store: OAuthGrantStore;
  readonly upserted: OAuthGrant[];
  readonly deleted: number;
}

function grants(
  options: { find?: () => Promise<OAuthGrant | undefined> } = {},
): GrantRecorder {
  const upserted: OAuthGrant[] = [];
  let deleted = 0;
  const recorder = {
    upserted,
    get deleted() {
      return deleted;
    },
    store: {
      upsert: (grant: OAuthGrant) => {
        upserted.push(grant);
        return Promise.resolve();
      },
      find: options.find ?? (() => Promise.resolve(undefined)),
      delete: () => {
        deleted += 1;
        return Promise.resolve();
      },
    } as unknown as OAuthGrantStore,
  };
  return recorder;
}

function client(overrides: Partial<SignInCredentialClient> = {}): {
  client: SignInCredentialClient;
  created: Array<MessageInitShape<typeof CredentialSchema>>;
} {
  const created: Array<MessageInitShape<typeof CredentialSchema>> = [];
  return {
    created,
    client: {
      create: async (credential) => {
        created.push(credential);
        return create(CredentialSchema, { metadata: { id: "cred_created" } });
      },
      setFields: () => Promise.reject(new Error("setFields reached")),
      removeFields: () => Promise.reject(new Error("removeFields reached")),
      delete: () => Promise.reject(new Error("delete reached")),
      ...overrides,
    },
  };
}

function deps(overrides: {
  store: Store;
  client: SignInCredentialClient;
  oauthGrants: OAuthGrantStore;
  secretService?: SecretService;
  logger?: ReturnType<typeof createLogger>;
}): McpServerConnectDeps {
  const logger = overrides.logger ?? silentLogger;
  return {
    store: overrides.store,
    logger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    engineState: untouchable("engineState"),
    executionContext: untouchable("executionContext"),
    runnerAuth: untouchable("runnerAuth"),
    credentials: untouchable("credentials"),
    signIns: new SignInCredentials(overrides.client, overrides.store, logger),
    oauthGrants: overrides.oauthGrants,
    pendingOAuthStates: pendingStates,
    secretService: overrides.secretService ?? SecretService.create(undefined),
    sandboxLane: { enabled: false },
    oauthRedirectUri: PENDING.redirectUri,
    outboundFetch: tokenEndpoint,
  };
}

const completeInput = () =>
  create(CompleteOAuthConnectInputSchema, {
    mcpServerId: SERVER_ID,
    state: PENDING.state,
    authorizationCode: "code_signin",
  });

describe("completeOAuthConnect — the sign-in's save", () => {
  it("an existing grant that cannot be looked up is logged, and the sign-in is saved into a new credential", async () => {
    const recorder = grants({
      find: () => Promise.reject(new Error("SQLITE_BUSY")),
    });
    const credentials = client();
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: ({ message }) => warnings.push(message),
    });

    const completed = await completeOAuthConnect(
      deps({
        store: storeWith(false),
        client: credentials.client,
        oauthGrants: recorder.store,
        logger,
      }),
      completeInput(),
      CALLER,
    );

    expect(completed.connected).toBe(true);
    expect(warnings).toContain(
      "Failed to look up an existing OAuth grant (non-fatal, a new sign-in credential is saved)",
    );
    expect(credentials.created).toHaveLength(1);
    expect(recorder.upserted.map((grant) => grant.credentialId)).toEqual([
      "cred_created",
    ]);
  });

  it("a refusal from the credential pipeline reaches the caller as the pipeline spoke it", async () => {
    const refusal = new ConnectError(
      "credential 'linear-0a1b2c3d' already serves MCP server 'signin'",
      Code.AlreadyExists,
    );
    const recorder = grants();

    const error = await errorOf(() =>
      completeOAuthConnect(
        deps({
          store: storeWith(false),
          client: client({ create: () => Promise.reject(refusal) }).client,
          oauthGrants: recorder.store,
        }),
        completeInput(),
        CALLER,
      ),
    );

    expect(error).toBe(refusal);
    expect(recorder.upserted).toHaveLength(0);
  });

  it("any other failure saving the token is a sanitized Internal", async () => {
    const recorder = grants();

    const error = await errorOf(() =>
      completeOAuthConnect(
        deps({
          store: storeWith(false),
          client: client({
            create: () => Promise.reject(new Error("socket hang up")),
          }).client,
          oauthGrants: recorder.store,
        }),
        completeInput(),
        CALLER,
      ),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to save the sign-in's access token");
    expect(recorder.upserted).toHaveLength(0);
  });

  it("a refresh token that cannot be sealed is Internal, and no grant holds it plaintext", async () => {
    const keyed = SecretService.create(randomBytes(32));
    const sealingFails = new Proxy(keyed, {
      get(target, prop) {
        if (prop === "encrypt") {
          return () => Promise.reject(new Error("kms unavailable"));
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const recorder = grants();

    const error = await errorOf(() =>
      completeOAuthConnect(
        deps({
          store: storeWith(false),
          client: client().client,
          oauthGrants: recorder.store,
          secretService: sealingFails,
        }),
        completeInput(),
        CALLER,
      ),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to seal the refresh token");
    expect(recorder.upserted).toHaveLength(0);
  });
});

describe("disconnectOAuth — the sign-in's credential", () => {
  it("a credential that cannot be deleted is Internal, and the grant is kept", async () => {
    const grant: OAuthGrant = {
      identityAccountId: CALLER.identityId,
      resourceId: SERVER_ID,
      resourceKind: "mcp_server",
      orgId: ORG,
      accessTokenExpiresAt: 0,
      clientId: PENDING.clientId,
      authMethod: "mcp_oauth",
      tokenEndpoint: PENDING.tokenEndpoint,
      accessTokenEnvVar: "SIGNIN_TOKEN",
      credentialId: "cred_held",
      refreshToken: "",
      createdAt: 0,
      updatedAt: 0,
    };
    const recorder = grants({ find: () => Promise.resolve(grant) });

    const error = await errorOf(() =>
      disconnectOAuth(
        deps({
          store: storeWith(true),
          client: client({
            delete: () =>
              Promise.reject(
                new ConnectError("database is locked", Code.Internal),
              ),
          }).client,
          oauthGrants: recorder.store,
        }),
        create(DisconnectOAuthInputSchema, { resourceId: SERVER_ID, org: ORG }),
        CALLER,
      ),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to delete the sign-in's credential");
    expect(recorder.deleted).toBe(0);
  });
});
