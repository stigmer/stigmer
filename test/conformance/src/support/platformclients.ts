// Platform-client provisioning for the enforcement arms.
// Domain: conformance support.
//
// The PlatformClient surface is cloud IAM vocabulary — the local OSS targets
// route none of its controllers — so these helpers deliberately live OUTSIDE
// ConformanceClients (which stays the shared-contract surface every suite
// sees) and build their own clients over the CLOUD_ENV contract, the same
// direct-createClient posture the identity bootstrap uses (harness/cloud-env).
// Only suites gated on the platformClientTokens capability may call them;
// everywhere else the CLOUD_ENV variables are absent by design and the
// loud requireCloudEnv failure is a suite-gating bug, not an environment one.
//
// The primary conformance user creates and deletes the arms' clients: it owns
// every org provisionTenancy creates, and org owners hold the PlatformClient
// lifecycle grants (the readout-bootstrap real-lane precedent).
import { createClient } from "@connectrpc/connect";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";

import {
  CLOUD_ENV,
  type PlatformClientCredentials,
} from "../harness/cloud-env";
import { createTransport } from "../harness/clients";

export interface ProvisionedPlatformClient {
  // metadata.id — the resource id the minted token's platform_client_id
  // claim carries, and the axis both editions' liveness reads resolve by.
  readonly id: string;
  readonly credentials: PlatformClientCredentials;
}

// gRPC base URL of the cloud service under test, from the CLOUD_ENV contract
// (published by the hermetic launcher or a readout-substrate bootstrap).
export function cloudGrpcBaseUrl(): string {
  return requireCloudEnv(CLOUD_ENV.address);
}

// Creates a PlatformClient in the given org as the primary conformance user.
// allowedOrigins is the browser-context allowlist the origin arm enforces
// against; omit it for clients whose tokens should pass from any context
// (empty allowlist = open, the SharingOriginPolicy doctrine).
export async function createEnforcementPlatformClient(options: {
  org: string;
  name: string;
  allowedOrigins?: readonly string[];
}): Promise<ProvisionedPlatformClient> {
  const created = await primaryPlatformClientCommand().create({
    apiVersion: "iam.stigmer.ai/v1",
    kind: "PlatformClient",
    metadata: { name: options.name, org: options.org },
    spec: {
      // The arms' minted identities are fresh user_ids that must not
      // pre-exist — the identity-bootstrap posture.
      autoProvisionAccounts: true,
      allowedOrigins: [...(options.allowedOrigins ?? [])],
    },
  });
  const id = created.platformClient?.metadata?.id;
  const clientId = created.platformClient?.spec?.clientId;
  if (
    id === undefined ||
    id === "" ||
    clientId === undefined ||
    clientId === "" ||
    created.clientSecret === ""
  ) {
    throw new Error(
      `PlatformClient create for ${options.name} returned no usable id/credentials`,
    );
  }
  return { id, credentials: { clientId, clientSecret: created.clientSecret } };
}

// Deletes a PlatformClient by resource id as the primary conformance user —
// the mutation whose revocation effect the deletion arm asserts.
export async function deletePlatformClientById(id: string): Promise<void> {
  await primaryPlatformClientCommand().delete({ resourceId: id });
}

function primaryPlatformClientCommand() {
  const transport = createTransport(cloudGrpcBaseUrl(), {
    bearerToken: requireCloudEnv(CLOUD_ENV.token),
  });
  return createClient(PlatformClientCommandController, transport);
}

function requireCloudEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: platform-client provisioning needs the CLOUD_ENV contract. ` +
        "These helpers are only reachable from suites gated on the platformClientTokens " +
        "capability, whose targets always publish it — an unset variable here means a " +
        "suite ran ungated on a target without the platform-client lane.",
    );
  }
  return value;
}
