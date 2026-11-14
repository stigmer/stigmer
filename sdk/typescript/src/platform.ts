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
  HelpLink as HelpLinkProto,
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
  /**
   * How an app installed on a person's computer signs in to this server:
   * the identity provider's issuer, the audience its access tokens carry
   * here, and the public native client registered for such apps. Read its
   * endpoints from the issuer's discovery document; never guess them.
   *
   * `undefined` when the server trusts every request (nothing to sign in
   * to), when it signs people in but registered no native client, and on a
   * server released before the field. Read it with
   * {@link authenticationRequired}: required and absent means the server
   * offers no sign-in to an installed app.
   */
  readonly nativeSignIn: NativeSignIn | undefined;
  /**
   * Where a person stuck on this server asks for help, as its operator set
   * it: an address and the words to show for it. Show it on your own
   * screens (sign-in, the page's chrome, every failure); never inside an
   * app a builder made for their own users, whose help is the builder's.
   *
   * `undefined` when the operator set none, on a server released before
   * the field, and when the server announced an address that is not an
   * absolute `https:`, `http:` or `mailto:` one, which is never handed on:
   * show no help link then, rather than a guess.
   */
  readonly help: HelpLink | undefined;
}

/** Where to ask for help, as {@link ServerInfo.help} reports it. */
export interface HelpLink {
  /** An absolute `https:`, `http:` or `mailto:` address. */
  readonly url: string;
  /** The words to show for it, at most 40 characters; plain text, never markup. */
  readonly label: string;
}

/** How an installed app signs in, as {@link ServerInfo.nativeSignIn} reports it. */
export interface NativeSignIn {
  /** The OpenID Connect issuer, exactly as its discovery document spells it. */
  readonly issuer: string;
  /** The audience the access token must carry for this server to accept it. */
  readonly audience: string;
  /** The public native client's id at the issuer: an identifier, not a secret. */
  readonly clientId: string;
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

/** The schemes a help address may carry: a web page or a mail address. */
const HELP_LINK_SCHEMES: ReadonlySet<string> = new Set(["https:", "http:", "mailto:"]);

/** The longest label a server announces (the server's own limit). */
const HELP_LABEL_MAX = 40;

/**
 * The announced help link, or undefined when there is none or it is not one
 * a client may render: a server checks its operator's address at boot, and
 * a client checks again because it meets servers it did not build. A label
 * that is empty or too long is replaced by "Get help", the server's own
 * default, rather than dropping a good address.
 */
function helpLinkOf(help: HelpLinkProto | undefined): HelpLink | undefined {
  if (help === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(help.url);
  } catch {
    return undefined;
  }
  if (!HELP_LINK_SCHEMES.has(parsed.protocol)) return undefined;
  const label = help.label.trim();
  return {
    url: help.url,
    label: label === "" || [...label].length > HELP_LABEL_MAX ? "Get help" : label,
  };
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
   * posture, how an installed app signs in, where to ask for help,
   * whether it holds one organization, and what an Environment does there. Answered before
   * sign-in: no credential is needed.
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
        nativeSignIn:
          resp.nativeSignIn === undefined
            ? undefined
            : {
                issuer: resp.nativeSignIn.issuer,
                audience: resp.nativeSignIn.audience,
                clientId: resp.nativeSignIn.clientId,
              },
        help: helpLinkOf(resp.help),
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
