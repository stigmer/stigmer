import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  GetLicenseStatusInputSchema,
  GetServerInfoInputSchema,
  PlatformQueryController,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type {
  GetLicenseStatusOutput,
  GetServerInfoOutput,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { wrapError } from "./gen/errors.js";
import {
  deploymentModeOf,
  type DeploymentMode,
} from "./resource-availability.js";

/** Server identity information returned by {@link PlatformClient.getServerInfo}. */
export interface ServerInfo {
  /** Server edition mapped to a {@link DeploymentMode}. */
  readonly deploymentMode: DeploymentMode;
  /** Raw server edition enum value. */
  readonly edition: ServerEdition;
  /** Semantic version of the server binary. */
  readonly version: string;
  /**
   * Whether the server authenticates its callers. `false` on a server that
   * trusts every request (the default single-operator posture), where
   * features that hand out credentials only a verifying server honours —
   * minting PlatformClient user tokens — are unavailable.
   *
   * `undefined` when the server predates the field, so its posture is
   * unknown: offer the feature and let the server's own answer decide.
   * Only an explicit `false` means the feature is unavailable.
   */
  readonly authenticationRequired: boolean | undefined;
}

/**
 * Client for platform-level queries (server info, capabilities, license).
 *
 * The {@link getServerInfo} method is the authoritative source for
 * deployment mode detection. It replaces URL-based hostname guessing
 * with a server-reported value. {@link getLicenseStatus} is its sibling
 * for the license the server holds; every edition answers it.
 */
export class PlatformClient {
  private readonly platform: Client<typeof PlatformQueryController>;

  constructor(transport: Transport) {
    this.platform = createClient(PlatformQueryController, transport);
  }

  /**
   * Retrieve the connected server's edition, version and authentication
   * posture.
   *
   * Maps the proto {@link ServerEdition} to a {@link DeploymentMode}
   * through {@link deploymentModeOf}:
   * - `oss` -> `"local"`
   * - `enterprise` -> `"enterprise"`
   * - `cloud` -> `"cloud"`
   * - unspecified/unknown -> `"cloud"` (safe default)
   */
  async getServerInfo(): Promise<ServerInfo> {
    try {
      const resp: GetServerInfoOutput = await this.platform.getServerInfo(
        create(GetServerInfoInputSchema, {}),
      );
      return {
        deploymentMode: deploymentModeOf(resp.edition),
        edition: resp.edition,
        version: resp.version,
        authenticationRequired: resp.authenticationRequired,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Retrieve the state of the license the connected server holds.
   *
   * Every edition answers: open source and Stigmer Cloud report `absent`
   * (neither holds a key); a Stigmer Enterprise deployment reports the
   * state of its configured ticket with the verified claims. Requires a
   * signed-in caller. The generated output is returned as it is, so the
   * presence contract it documents (claims exactly when a ticket verified,
   * key id whenever one was presented) reaches the caller unchanged.
   */
  async getLicenseStatus(): Promise<GetLicenseStatusOutput> {
    try {
      return await this.platform.getLicenseStatus(
        create(GetLicenseStatusInputSchema, {}),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }
}
