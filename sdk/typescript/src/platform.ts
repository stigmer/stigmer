import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  GetLicenseStatusInputSchema,
  GetServerInfoInputSchema,
  PlatformQueryController,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import type {
  GetLicenseStatusOutput,
  GetServerInfoOutput,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import {
  GetModelReadinessInputSchema,
  ModelOnEngineSchema,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import type { GetModelReadinessOutput } from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import type { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
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
   * minting user tokens — are unavailable.
   *
   * `undefined` when the server predates the field, so its posture is
   * unknown: offer the feature and let the server's own answer decide.
   * Only an explicit `false` means the feature is unavailable.
   */
  readonly authenticationRequired: boolean | undefined;
  /**
   * Whether the server holds one organization and fills it into every call
   * that names none — the open-source edition. `true`: leave `org` empty
   * everywhere, and never show or ask for an organization. `false`: the
   * server holds several, so a call names its organization.
   *
   * `undefined` when the server predates the field: treat it as `false`
   * and show organizations.
   */
  readonly singleOrg: boolean | undefined;
  /**
   * What an Environment does on this server: whether one governs the
   * conversations a console, the CLI, a routine, a channel or a chat link
   * starts (`applies`), and whether its sandboxes can hold a conversation to
   * listed hosts (`limitedNetworking`) and install packages (`packages`).
   * Each answer is the one the server's own refusals give.
   *
   * `undefined` when the server predates the field: offer Environments and
   * let the server's own refusals decide.
   */
  readonly environments: EnvironmentAvailability | undefined;
}

/** What an Environment does on a server, as {@link ServerInfo.environments} reports it. */
export interface EnvironmentAvailability {
  /**
   * Whether a conversation that names no execution target runs in a sandbox
   * the server starts, so an Environment governs it. `false` where such
   * conversations run on the person's own machine or an operator's runner.
   */
  readonly applies: boolean;
  /** Whether the server's sandboxes can hold a conversation to an Environment's listed hosts. */
  readonly limitedNetworking: boolean;
  /** Whether the server's sandboxes can install an Environment's packages. */
  readonly packages: boolean;
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
   * Retrieve the connected server's edition, version, authentication
   * posture, whether it holds one organization, and what an Environment
   * does there.
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
        singleOrg: resp.singleOrg,
        environments:
          resp.environments === undefined
            ? undefined
            : {
                applies: resp.environments.applies,
                limitedNetworking: resp.environments.limitedNetworking,
                packages: resp.environments.packages,
              },
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

  /**
   * Which model providers serve an organization, and for every model on
   * every engine whether a run of it would start. A run whose provider is
   * missing is refused at create by the same rule, so a client can mark a
   * model before the person tries it. Every edition answers; any member of
   * the organization may ask.
   *
   * @param org - The organization the answer is for.
   * @param model - A model to judge beside the catalog's, such as an
   *   `openai:<name>` reference the catalog does not list.
   */
  async getModelReadiness(
    org: string,
    model?: { readonly harness: Harness; readonly model: string },
  ): Promise<GetModelReadinessOutput> {
    try {
      return await this.platform.getModelReadiness(
        create(GetModelReadinessInputSchema, {
          org,
          model: model === undefined ? undefined : create(ModelOnEngineSchema, model),
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }
}
