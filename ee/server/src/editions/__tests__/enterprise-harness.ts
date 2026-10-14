/**
 * Test support for the self-hosted Enterprise server's composed suites: a
 * server booted the way its entry boots it (the license verdict from
 * `composeEnterprise`, then the library's own composition and start), with
 * the test's own ring, clock, database and dialer, and people who sign in
 * through the library's OIDC lane against a loopback issuer.
 *
 * Every composed server here signs its callers in through
 * `STIGMER_OIDC_ISSUER` (the operator's issuer, `operator` on the loopback
 * server); a person first calls `provisionMyAccount`, as a person's first
 * sign-in does, and acts with that token from then on. An identity
 * provider names the loopback server's https spelling of another issuer,
 * which the composition's guarded fetch dials through the loopback
 * server's dialer, so the provider's save and its sign-ins read real
 * documents and keys through the production egress posture.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ConnectError, createClient } from "@connectrpc/connect";
import type { Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import type { Pool } from "pg";

import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
  type ApiResourceRef,
  type GrantSpec,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { FederationIssuerCommandController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/command_pb";
import type { FederationIssuer, FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import {
  composeServer,
  createLogger,
  encodeInProcessCaller,
  IN_PROCESS_CALLER_HEADER,
  loadConfig,
} from "@stigmer/server";
import type { ComposedServer, Logger, ServerExtension } from "@stigmer/server";

import type { LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { composeEnterprise } from "../enterprise.js";
import type { EgressPosture } from "../enterprise-config.js";

/** The audience every operator token carries. */
export const OPERATOR_AUDIENCE = "https://stigmer.example/api";

/** The operator's issuer on the loopback server. */
export const OPERATOR_ISSUER_NAME = "operator";

export const SILENT_LOGGER: Logger = createLogger({ level: "error", pretty: false, write: () => {} });

/** A clock the suite moves. */
export interface TestClock {
  now: Date;
  readonly read: () => Date;
}

export function testClock(at: Date): TestClock {
  const clock: TestClock = {
    now: at,
    read: () => clock.now,
  };
  return clock;
}

export interface BootOptions {
  readonly issuer: LoopbackIssuer;
  readonly licenseKey?: string;
  readonly ring?: ReadonlyMap<string, Uint8Array>;
  readonly clock?: () => Date;
  /** The Postgres database; absent, the server runs on SQLite in a temporary folder. */
  readonly databaseUrl?: string;
  readonly pool?: Pool;
  /** Wraps the loopback dialer, to observe what the guarded fetch dials. */
  readonly dialer?: typeof fetch;
  /**
   * The egress posture; the server's own default (strict) when absent. A
   * suite whose providers live on the loopback issuer passes `relaxed`.
   */
  readonly egress?: EgressPosture;
  /** Days the access history is kept; absent keeps every entry. */
  readonly accessHistoryRetentionDays?: number;
  /** The accounts that may create a top-level organization; absent means anyone signed in. */
  readonly organizationCreators?: ReadonlySet<string>;
  /** Units the suite composes after the entry's, to receive the composition's hand-over. */
  readonly extraUnits?: ReadonlyArray<ServerExtension>;
}

export interface BootedServer {
  readonly server: ComposedServer;
  readonly port: number;
  readonly units: ReadonlyArray<ServerExtension>;
  close(): Promise<void>;
}

/** Composes and starts a server from the license verdict, as the entry does. */
export async function bootEnterprise(options: BootOptions): Promise<BootedServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "enterprise-server-"));
  const config = loadConfig({
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
    TEMPORAL_HOST_PORT: "127.0.0.1:1",
    STORAGE_PATH: path.join(dir, "storage"),
    ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    STIGMER_OIDC_ISSUER: options.issuer.issuerUrl(OPERATOR_ISSUER_NAME),
    STIGMER_OIDC_AUDIENCE: OPERATOR_AUDIENCE,
    ...(options.databaseUrl === undefined
      ? { DB_PATH: path.join(dir, "stigmer.db") }
      : { DATABASE_URL: options.databaseUrl }),
  });
  const units = await composeEnterprise(
    { config, logger: SILENT_LOGGER },
    {
      licenseKey: options.licenseKey,
      ...(options.ring === undefined ? {} : { ring: options.ring }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.pool === undefined ? {} : { pool: options.pool }),
      fetchImpl: options.dialer ?? options.issuer.fetch,
      keyLoader: { env: {}, homeDir: dir },
      ...(options.egress === undefined ? {} : { egress: options.egress }),
      ...(options.accessHistoryRetentionDays === undefined
        ? {}
        : { accessHistoryRetentionDays: options.accessHistoryRetentionDays }),
      ...(options.organizationCreators === undefined
        ? {}
        : { organizationCreators: options.organizationCreators }),
    },
  );
  const server = await composeServer({
    config,
    logger: SILENT_LOGGER,
    extensions: [...units, ...(options.extraUnits ?? [])],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  return {
    server,
    port,
    units,
    async close(): Promise<void> {
      await server.shutdown();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function bearer(token: string): Interceptor {
  return (next) => (request) => {
    request.header.set("authorization", `Bearer ${token}`);
    return next(request);
  };
}

/** A transport to the server, presenting `token` when given. */
export function transportTo(port: number, token?: string): Transport {
  return createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    interceptors: token === undefined ? [] : [bearer(token)],
  });
}

/** A person signed in through the operator's issuer: their token, account and transport. */
export interface Person {
  readonly sub: string;
  readonly token: string;
  readonly accountId: string;
  readonly transport: Transport;
}

/** Signs `sub` in through the operator's issuer and provisions their account. */
export async function signIn(booted: BootedServer, issuer: LoopbackIssuer, sub: string): Promise<Person> {
  const token = issuer.mint(OPERATOR_ISSUER_NAME, {
    sub,
    aud: OPERATOR_AUDIENCE,
    email: `${sub.replace(/[^a-z0-9]/g, ".")}@acme.example`,
  });
  const transport = transportTo(booted.port, token);
  const account = await createClient(IdentityAccountCommandController, transport).provisionMyAccount({});
  return { sub, token, accountId: account.metadata?.id ?? "", transport };
}

/** Creates an organization as `founder`; answers its id. */
export async function createOrganization(founder: Person, slug: string): Promise<string> {
  const created = await createClient(OrganizationCommandController, founder.transport).create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: "a self-hosted Enterprise organization" },
  });
  return created.metadata?.id ?? "";
}

/** A federation issuer request over the loopback server's https spelling of `issuerName` (its slug by default). */
export function providerRequest(
  issuer: LoopbackIssuer,
  org: string,
  slug: string,
  options: {
    readonly id?: string;
    readonly issuerName?: string;
    readonly displayName?: string;
    readonly issuers?: ReadonlyArray<string>;
    readonly jwksUri?: string;
  } = {},
): MessageInitShape<typeof FederationIssuerSchema> {
  const issuerUrl = issuer.tlsIssuerUrl(options.issuerName ?? slug);
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "FederationIssuer",
    metadata: { name: slug, slug, org, ...(options.id === undefined ? {} : { id: options.id }) },
    spec: {
      displayName: options.displayName ?? slug,
      jwksUri: options.jwksUri ?? `${issuerUrl}/jwks`,
      allowedIssuers: [...(options.issuers ?? [issuerUrl])],
      expectedAudience: `stigmer:${slug}`,
      createAccountsOnSignIn: true,
      signInRole: IamRole.viewer,
    },
  };
}

/** Creates a federation issuer as `admin`; answers it. */
export async function createIssuer(
  admin: Person,
  issuer: LoopbackIssuer,
  org: string,
  slug: string,
): Promise<FederationIssuer> {
  return createClient(FederationIssuerCommandController, admin.transport).create(
    providerRequest(issuer, org, slug),
  );
}

/** A federated person's token from the provider named `slug`. */
export function federatedToken(issuer: LoopbackIssuer, slug: string, sub: string, email: string): string {
  return issuer.mint(slug, { sub, aud: `stigmer:${slug}`, email, tls: true });
}

export function ref(kind: string, id: string): ApiResourceRef {
  return create(ApiResourceRefSchema, { kind, id });
}

export function grant(principal: ApiResourceRef, relation: string, resource: ApiResourceRef): GrantSpec {
  return create(GrantSpecSchema, { principal, relation, resource });
}

/** The refusal `work` ends in. */
export async function refusalOf(work: Promise<unknown>): Promise<ConnectError> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof ConnectError)) {
    throw new Error(`expected a refusal, got ${error === undefined ? "an answer" : String(error)}`);
  }
  return error;
}

/** The call options acting as `accountId`, a signed-in person, on the in-process transport. */
function asAccount(accountId: string): { headers: Record<string, string> } {
  return {
    headers: {
      [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller({
        identityId: accountId,
        callerClass: "user",
        issuer: "",
        rawToken: "",
      }),
    },
  };
}

/** Mints a key for `accountId` through the library's own key lane, as that person; answers the raw key. */
export async function issueKey(server: ComposedServer, accountId: string, org: string): Promise<string> {
  const key = await createClient(ApiKeyCommandController, server.inProcessTransport).create(
    {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: `key of ${accountId}`, org },
      spec: {},
    },
    asAccount(accountId),
  );
  return key.spec?.keyHash ?? "";
}

/**
 * How many keys speak for `accountId`: every stored key whose creator is
 * the account, read from the composition's store, so a key left behind by
 * an account that no longer exists is still counted.
 */
export async function keysOf(server: ComposedServer, accountId: string): Promise<number> {
  const rows = await server.store.listResources(ApiResourceKind.api_key);
  return rows
    .map((data) => fromBinary(ApiKeySchema, data))
    .filter((key) => key.status?.audit?.specAudit?.createdBy?.id === accountId).length;
}

/** How many grant rows name `id` as an identity account, principal or resource. */
export async function grantRowsNaming(server: ComposedServer, id: string): Promise<number> {
  const rows = await server.store.listResources(ApiResourceKind.grant);
  return rows
    .map((data) => fromBinary(GrantSchema, data))
    .filter(
      (row) =>
        (row.spec?.principal?.kind === "identity_account" && row.spec.principal.id === id) ||
        (row.spec?.resource?.kind === "identity_account" && row.spec.resource.id === id),
    ).length;
}
