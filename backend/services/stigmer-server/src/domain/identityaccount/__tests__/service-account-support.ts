/**
 * Fixtures for the composed service-account suites: a server booted with
 * sign-in on and the built-in Authorizer (a unit that declares the
 * require-authentication posture and vouches for the fake verifier's
 * tokens, registering no Authorizer: the open-source sign-in self-host's
 * shape, extensions/__tests__/composed-support.ts), and the moves every
 * such suite makes over the wire: provision a person, found an
 * organization, create a service account in it, mint the account's key,
 * and talk as that key.
 *
 * Roles come from the open-source membership rules and nothing else: a
 * person who founds an organization after provisioning owns it (the
 * organization's creator row), and a person who provisions after an
 * organization exists is its member (arm 5). A suite that needs a person
 * with another role grants it through IamPolicy as the founder.
 *
 * `logs` holds every line the server wrote at info and above, parsed, so
 * a suite can read what the grant path records (its cause, its actor)
 * where open source keeps no history table.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";

import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { organizationInput } from "../../organization/__tests__/support.js";

/** One parsed server log line: its message and its fields. */
export type LogEntry = Readonly<Record<string, unknown>> & {
  readonly message?: string;
};

export interface SignInServer {
  readonly server: ComposedServer;
  readonly port: number;
  /** Every line the server logged at info and above, in order. */
  readonly logs: LogEntry[];
  /** A transport presenting the fake verifier's token for `sub`. */
  as(sub: string): Transport;
  /** A transport presenting `token` as it is (an API key's plaintext). */
  presenting(token: string): Transport;
  shutdown(): Promise<void>;
}

/**
 * Boots a composed server with sign-in on. `unit` adds to the fake
 * verifier's unit (an Authorizer, a lifecycle driver), so a suite can
 * swap the built-in posture for a composition's own.
 */
export async function bootSignInServer(
  prefix: string,
  unit: Omit<
    ServerExtension,
    "name" | "requireAuthentication" | "identityVerifiers"
  > = {},
): Promise<SignInServer> {
  const dir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const logs: LogEntry[] = [];
  const extension: ServerExtension = {
    ...unit,
    name: "fake-sign-in",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };
  const server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: createLogger({
      level: "info",
      pretty: false,
      write: (line) => {
        logs.push(JSON.parse(line) as LogEntry);
      },
    }),
    extensions: [extension],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  return {
    server,
    port,
    logs,
    as: (sub) => transportFor(port, fakeJwt(sub, emailOf(sub))),
    presenting: (token) => transportFor(port, token),
    async shutdown() {
      await server.shutdown();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The email the fake token carries for `sub`. */
export function emailOf(sub: string): string {
  return `${sub.replace(/[^a-z0-9]/gi, "-")}@example.com`;
}

/** Provisions `sub`'s account through its own first sign-in; its id. */
export async function provision(
  at: SignInServer,
  sub: string,
): Promise<string> {
  const account = await createClient(
    IdentityAccountCommandController,
    at.as(sub),
  ).provisionMyAccount({});
  return account.metadata?.id ?? "";
}

/** Creates an organization as the transport's caller; its minted id. */
export async function foundOrganization(
  transport: Transport,
  slug: string,
): Promise<string> {
  const created = await createClient(
    OrganizationCommandController,
    transport,
  ).create(organizationInput(slug));
  return created.metadata?.id ?? "";
}

/** createServiceAccount as the transport's caller. */
export function createServiceAccount(
  transport: Transport,
  org: string,
  name: string,
  role: IamRole,
): Promise<IdentityAccount> {
  return createClient(
    IdentityAccountCommandController,
    transport,
  ).createServiceAccount({ org, name, role });
}

/** Mints a never-expiring key for the service account as the transport's caller; its plaintext. */
export async function mintServiceAccountKey(
  transport: Transport,
  serviceAccountId: string,
  name: string,
): Promise<string> {
  const key = await createClient(
    ApiKeyCommandController,
    transport,
  ).createForServiceAccount({ serviceAccountId, name, neverExpires: true });
  return key.spec?.keyHash ?? "";
}

/** The ConnectError a call fails with; a call that succeeds fails the test. */
export async function refusal(
  promise: Promise<unknown>,
): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to be refused");
}
