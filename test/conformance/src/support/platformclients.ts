// PlatformClient fixtures for the conformance suites.
// Domain: conformance support.
//
// Every edition serves PlatformClient, so these helpers take the clients
// to act through instead of reaching for an environment: the CRUD suite
// passes the target's primary clients, and the enforcement suite passes its
// enforcing lane's founder (the cloud's primary; open source's sibling in
// the OIDC posture, the only posture in which a server mints tokens). The
// founder owns every organization the lane provisions, and organization
// owners hold the PlatformClient lifecycle.
import type { PlatformClientCreateResponse } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { ConformanceClients } from "../harness/clients";

export interface PlatformClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface ProvisionedPlatformClient {
  // metadata.id — the resource id the minted token's platform_client_id
  // claim carries, and the axis both editions' liveness reads resolve by.
  readonly id: string;
  readonly slug: string;
  readonly credentials: PlatformClientCredentials;
  readonly created: PlatformClientCreateResponse;
}

export interface PlatformClientOptions {
  readonly org: string;
  readonly name: string;
  // The browser-context allowlist the origin arm enforces; omitted = open.
  readonly allowedOrigins?: readonly string[];
  // JIT provisioning: the arms mint fresh user_ids that must not pre-exist.
  readonly autoProvisionAccounts?: boolean;
  readonly autoGrantRole?: IamRole;
}

// Creates a PlatformClient in the org through `clients`, answering its id
// and the one look at its secret.
export async function createPlatformClient(
  clients: ConformanceClients,
  options: PlatformClientOptions,
): Promise<ProvisionedPlatformClient> {
  const created = await clients.platformClientCommand.create({
    apiVersion: "iam.stigmer.ai/v1",
    kind: "PlatformClient",
    metadata: { name: options.name, org: options.org },
    spec: {
      autoProvisionAccounts: options.autoProvisionAccounts ?? true,
      autoGrantOnOrg: options.autoGrantRole !== undefined,
      ...(options.autoGrantRole !== undefined
        ? { autoGrantRole: options.autoGrantRole }
        : {}),
      allowedOrigins: [...(options.allowedOrigins ?? [])],
    },
  });
  const id = created.platformClient?.metadata?.id ?? "";
  const slug = created.platformClient?.metadata?.slug ?? "";
  const clientId = created.platformClient?.spec?.clientId ?? "";
  if (id === "" || slug === "" || clientId === "" || created.clientSecret === "") {
    throw new Error(
      `PlatformClient create for ${options.name} returned no usable id, slug or credentials`,
    );
  }
  return {
    id,
    slug,
    credentials: { clientId, clientSecret: created.clientSecret },
    created,
  };
}

export async function deletePlatformClient(
  clients: ConformanceClients,
  id: string,
): Promise<void> {
  await clients.platformClientCommand.delete({ resourceId: id });
}

// Mints a user token for `userId` through the public token service — any
// clients reach it, since the credentials travel in the request body.
export async function mintUserToken(
  clients: ConformanceClients,
  credentials: PlatformClientCredentials,
  userId: string,
  extra: { userEmail?: string; userName?: string; orgId?: string } = {},
): Promise<string> {
  const minted = await clients.platformClientToken.mintUserToken({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    userId,
    ...extra,
  });
  if (minted.accessToken === "" || minted.tokenType !== "Bearer") {
    throw new Error(`mintUserToken for ${userId} returned no Bearer token`);
  }
  return minted.accessToken;
}
