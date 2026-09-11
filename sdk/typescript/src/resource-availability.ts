/**
 * The edition vocabulary of the SDK: which edition a server is, in the
 * SDK's own words, and whether a resource kind is served there.
 *
 * Four facts this module is built on (editions program, DD-001):
 *
 * - A kind's `ResourceTier` names the MINIMUM edition that serves it. The
 *   editions are ordered oss < enterprise < cloud because each composes the
 *   previous one's extension units, so a tier admits its own edition and
 *   every edition above it.
 * - The proto enums' numbers are wire identifiers, not ranks: `enterprise`
 *   was added after `cloud` / `cloud_only` and sits at 3 in both. The two
 *   rank functions below are the ONLY place a tier meets an edition; nothing
 *   compares enum numbers.
 * - `DeploymentMode` is `ServerEdition` in string-literal form, the shape
 *   React consumers expect (`colorMode: "light" | "dark"` is the sibling),
 *   with `oss` spelled `"local"` for history's sake. `deploymentModeOf` is
 *   the ONE converter; it must never grow a second implementation.
 * - An older client must not break against a newer server: an edition value
 *   this SDK does not know maps to `"cloud"` (nothing hidden) instead of
 *   throwing. The switch is exhaustive at compile time so a new edition is
 *   still a compile error here; the runtime fallback is for the wire.
 *
 * `DeploymentMode` answers a TIER question ("is this kind served here?").
 * Sites that use it to ask a FACILITY question ("does this server have a
 * wallet?") compare `=== "cloud"` deliberately and say which facility they
 * mean; see the React SDK's deployment-mode consumers.
 */
import {
  ResourceTier,
  type ApiResourceKind,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { KIND_TIERS } from "./gen/resource-availability.js";

/**
 * Edition of the Stigmer backend the client is connected to, as reported
 * by {@link PlatformClient.getServerInfo}.
 *
 * - `"local"` — Stigmer, the open-source edition. `open_source`-tier
 *   resources are served.
 * - `"enterprise"` — Stigmer Enterprise, self-hosted. `open_source`- and
 *   `enterprise`-tier resources are served.
 * - `"cloud"` — Stigmer Cloud. Every resource is served.
 */
export type DeploymentMode = "local" | "enterprise" | "cloud";

/**
 * The one edition-to-mode converter.
 *
 * `server_edition_unspecified` and any value this SDK does not know map to
 * `"cloud"`: a broken or newer server hides nothing, which is the failure a
 * client can live with. The `never` default keeps the switch exhaustive for
 * the editions this SDK knows.
 */
export function deploymentModeOf(edition: ServerEdition): DeploymentMode {
  switch (edition) {
    case ServerEdition.oss:
      return "local";
    case ServerEdition.enterprise:
      return "enterprise";
    case ServerEdition.cloud:
    case ServerEdition.server_edition_unspecified:
      return "cloud";
    default: {
      const _exhaustive: never = edition;
      void _exhaustive;
      return "cloud";
    }
  }
}

/**
 * Check whether a resource kind is served in the given deployment mode.
 *
 * A kind is served when the mode's edition ranks at or above the kind's
 * minimum edition. Throws for a kind with no tier (only
 * `api_resource_kind_unknown`): that is a programming error, and answering
 * "available" for it would hide the bug.
 */
export function isResourceAvailable(
  kind: ApiResourceKind,
  mode: DeploymentMode,
): boolean {
  const tier = KIND_TIERS.get(kind);
  if (tier === undefined) {
    throw new Error(
      `isResourceAvailable: kind ${kind} has no tier — only kinds with kind_meta can be asked about`,
    );
  }
  return editionRank(mode) >= tierRank(tier);
}

/** Position of an edition in the oss < enterprise < cloud order. */
function editionRank(mode: DeploymentMode): number {
  switch (mode) {
    case "local":
      return 1;
    case "enterprise":
      return 2;
    case "cloud":
      return 3;
    default: {
      const _exhaustive: never = mode;
      throw new Error(`unknown deployment mode: ${String(_exhaustive)}`);
    }
  }
}

/** Position of a tier's minimum edition in the same order. */
function tierRank(tier: ResourceTier): number {
  switch (tier) {
    case ResourceTier.open_source:
      return 1;
    case ResourceTier.enterprise:
      return 2;
    case ResourceTier.cloud_only:
      return 3;
    case ResourceTier.resource_tier_unspecified:
      // A kind without a declared tier is treated as core: the generator
      // emits every kind_meta tier verbatim, so this arm is reachable only
      // by a proto that forgot the field, and hiding a kind is the worse
      // failure for a client.
      return 1;
    default: {
      const _exhaustive: never = tier;
      throw new Error(`unknown resource tier: ${String(_exhaustive)}`);
    }
  }
}
