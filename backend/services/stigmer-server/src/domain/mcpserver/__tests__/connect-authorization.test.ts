/**
 * Pins the C2 Stage-4 enforcement on the six config-annotated connect
 * lanes (connect, startConnect, initiateOAuthConnect,
 * completeOAuthConnect, disconnectOAuth, getOAuthGrantStatus): each
 * evaluates its OWN annotation through authorizeDirect, and a denying
 * authorizer answers PERMISSION_DENIED with the method's byte-pinned
 * error_msg. Java-parity orders are asserted structurally:
 *
 *   - connect/startConnect/initiateOAuthConnect authorize AFTER the load
 *     (stigmer#224 — a missing server answers NOT_FOUND even to a caller
 *     the authorizer would deny);
 *   - completeOAuthConnect authorizes against the PENDING RECORD's server
 *     id, and the single-use state is burned before the denial lands (the
 *     Java discipline — asserted via the consumed-state refusal on retry);
 *   - disconnectOAuth/getOAuthGrantStatus authorize before any grant
 *     lookup (the grant store is untouchable under denial).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  CompleteOAuthConnectInputSchema,
  ConnectInputSchema,
  DisconnectOAuthInputSchema,
  GetOAuthGrantStatusInputSchema,
  InitiateOAuthConnectInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { SqliteStore } from "../../../store/sqlite/store.js";

import { connect } from "../connect.js";
import type { McpServerConnectDeps } from "../connect.js";
import { completeOAuthConnect } from "../complete-oauth-connect.js";
import { disconnectOAuth } from "../disconnect-oauth.js";
import { getOAuthGrantStatus } from "../get-oauth-grant-status.js";
import { initiateOAuthConnect } from "../initiate-oauth-connect.js";
import { startConnect } from "../start-connect.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const caller = testCallerIdentity();

/** Records every check and denies — the arm + target assertions read it. */
function denyingAuthorizer(): { authorizer: Authorizer; checks: AuthzCheck[] } {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve({ kind: "deny", reason: "" });
      },
    },
  };
}

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mcps-authz-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seedServer(id: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.mcp_server,
    id,
    McpServerSchema,
    create(McpServerSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "McpServer",
      metadata: { id, name: id, org: "test-org" },
    }),
  );
}

function deps(authorizer: Authorizer): McpServerConnectDeps {
  // Only the members a lane touches BEFORE its authorize call are real;
  // everything after the denial is unreachable and throws if touched.
  const unreachable = <T extends object>(name: string): T =>
    new Proxy({} as T, {
      get(_target, prop) {
        throw new Error(`${name}.${String(prop)} reached despite the denial`);
      },
    });
  return {
    store,
    logger: silentLogger,
    authorizer,
    engineState: () => ({
      connected: true,
      engine: unreachable("engine"),
    }),
    environmentReader: unreachable("environmentReader"),
    executionContext: unreachable("executionContext"),
    runnerAuth: unreachable("runnerAuth"),
    managedEnv: unreachable("managedEnv"),
    oauthGrants: unreachable("oauthGrants"),
    pendingOAuthStates: store.pendingOAuthStates,
    secretService: unreachable("secretService"),
    oauthRedirectUri: "http://localhost:7233/oauth/callback",
  };
}

async function expectDenied(run: () => Promise<unknown>, copy: string) {
  const error = await run().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ConnectError);
  expect((error as ConnectError).code).toBe(Code.PermissionDenied);
  expect((error as ConnectError).rawMessage).toBe(copy);
}

describe("connect-lane authorization (C2 Stage 4)", () => {
  it("connect: a missing server answers NOT_FOUND even under denial (load-first, #224); an existing one denies with the annotation copy", async () => {
    const { authorizer } = denyingAuthorizer();
    const missing = await connect(
      deps(authorizer),
      create(ConnectInputSchema, { mcpServerId: "mcps_missing", org: "o" }),
      caller,
    ).catch((e: unknown) => e);
    expect((missing as ConnectError).code).toBe(Code.NotFound);

    await seedServer("mcps_denied");
    await expectDenied(
      () =>
        connect(
          deps(authorizer),
          create(ConnectInputSchema, { mcpServerId: "mcps_denied", org: "o" }),
          caller,
        ),
      "unauthorized to connect to mcp server",
    );
  });

  it("startConnect denies with the shared connect annotation copy after the load", async () => {
    const { authorizer } = denyingAuthorizer();
    await seedServer("mcps_denied");
    await expectDenied(
      () =>
        startConnect(
          deps(authorizer),
          create(ConnectInputSchema, { mcpServerId: "mcps_denied", org: "o" }),
          caller,
        ),
      "unauthorized to connect to mcp server",
    );
  });

  it("initiateOAuthConnect denies with its annotation copy after the load", async () => {
    const { authorizer } = denyingAuthorizer();
    await seedServer("mcps_denied");
    await expectDenied(
      () =>
        initiateOAuthConnect(
          deps(authorizer),
          create(InitiateOAuthConnectInputSchema, {
            mcpServerId: "mcps_denied",
          }),
          caller,
        ),
      "unauthorized to initiate oauth connect for mcp server",
    );
  });

  it("completeOAuthConnect authorizes the PENDING RECORD's id and burns the state before the denial", async () => {
    const { authorizer, checks } = denyingAuthorizer();
    await store.pendingOAuthStates.save({
      state: "state-123",
      codeVerifier: "",
      clientId: "",
      clientSecret: "",
      tokenEndpoint: "",
      mcpServerId: "mcps_pending",
      identityAccountId: "",
      targetEnvVar: "",
      authMethod: "mcp_oauth",
      tokenAuthMethod: "",
      redirectUri: "",
      org: "test-org",
      createdAt: 0,
    });

    await expectDenied(
      () =>
        completeOAuthConnect(
          deps(authorizer),
          create(CompleteOAuthConnectInputSchema, {
            mcpServerId: "mcps_pending",
            state: "state-123",
            authorizationCode: "code",
          }),
          caller,
        ),
      "unauthorized to complete oauth connect for mcp server",
    );
    // The target of record is the server-side pending state's id.
    expect(checks[0].resourceId).toBe("mcps_pending");
    // The single-use state was consumed before the denial (Java parity):
    // a retry refuses on the missing state, not on authorization.
    const retry = await completeOAuthConnect(
      deps(authorizer),
      create(CompleteOAuthConnectInputSchema, {
        mcpServerId: "mcps_pending",
        state: "state-123",
        authorizationCode: "code",
      }),
      caller,
    ).catch((e: unknown) => e);
    expect((retry as ConnectError).code).toBe(Code.FailedPrecondition);
  });

  it("disconnectOAuth denies with its annotation copy before any grant lookup", async () => {
    const { authorizer } = denyingAuthorizer();
    await expectDenied(
      () =>
        disconnectOAuth(
          deps(authorizer),
          create(DisconnectOAuthInputSchema, {
            resourceId: "mcps_denied",
            org: "o",
          }),
          caller,
        ),
      "unauthorized to disconnect oauth for mcp server",
    );
  });

  it("getOAuthGrantStatus denies with its annotation copy before any grant lookup", async () => {
    const { authorizer } = denyingAuthorizer();
    await expectDenied(
      () =>
        getOAuthGrantStatus(
          deps(authorizer),
          create(GetOAuthGrantStatusInputSchema, {
            resourceId: "mcps_denied",
            org: "o",
          }),
          caller,
        ),
      "unauthorized to view oauth status for mcp server",
    );
  });
});
