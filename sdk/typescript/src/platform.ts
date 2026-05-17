import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  GetServerInfoInputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type { GetServerInfoOutput } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { wrapError } from "./gen/errors";
import type { DeploymentMode } from "./resource-availability";

/** Server identity information returned by {@link PlatformClient.getServerInfo}. */
export interface ServerInfo {
  /** Server edition mapped to a {@link DeploymentMode}. */
  readonly deploymentMode: DeploymentMode;
  /** Raw server edition enum value. */
  readonly edition: ServerEdition;
  /** Semantic version of the server binary. */
  readonly version: string;
}

/**
 * Client for platform-level queries (server info, capabilities).
 *
 * The {@link getServerInfo} method is the authoritative source for
 * deployment mode detection. It replaces URL-based hostname guessing
 * with a server-reported value.
 */
export class PlatformClient {
  private readonly platform: Client<typeof PlatformQueryController>;

  constructor(transport: Transport) {
    this.platform = createClient(PlatformQueryController, transport);
  }

  /**
   * Retrieve the connected server's edition and version.
   *
   * Maps the proto {@link ServerEdition} to a {@link DeploymentMode}:
   * - `oss` -> `"local"`
   * - `cloud` -> `"cloud"`
   * - unspecified/unknown -> `"cloud"` (safe default)
   */
  async getServerInfo(): Promise<ServerInfo> {
    try {
      const resp: GetServerInfoOutput = await this.platform.getServerInfo(
        create(GetServerInfoInputSchema, {}),
      );
      return {
        deploymentMode: resp.edition === ServerEdition.oss ? "local" : "cloud",
        edition: resp.edition,
        version: resp.version,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }
}
