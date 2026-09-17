// The default plugins a fresh local backend is bootstrapped with: the
// `defaults` list of the official marketplace, installed in order into the
// system org as public, so the global default-agent lookup and cross-org
// references find them exactly where the seedpack used to put them.
//
// Idempotent by the server's own identity, not a marker file: before each
// push the entry is prepared (walked, zipped, hashed) and the org's plugin
// of that name is read back; when its digest equals the prepared archive's,
// it is READY and it is public, there is nothing to do and nothing is sent.
// A second `stigmer up` therefore pushes nothing, and a `stigmer up` after
// an upgrade pushes exactly the entries whose content changed. The record is
// the server, so any machine that reaches the same backend sees the same
// answer (the seedpack's cloud-mode rule, made the only rule).
//
// Best-effort per entry: one default failing to install does not stop the
// next, and the caller decides how to surface the failures (the daemon
// launcher warns and names `stigmer install <name>`).

import { type Stigmer, isNotFound } from "@stigmer/sdk";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { log } from "../../logger.js";
import { VERSION } from "../../version.js";
import {
  type ResolveOfficialOptions,
  resolveOfficialMarketplace,
} from "../../marketplace/official.js";
import { readMarketplaceTree } from "../../marketplace/read.js";
import { prepareEntry } from "../../marketplace/install.js";
import {
  type PreparedPluginPush,
  pushPrepared,
} from "../../resources/plugin.js";

export interface DefaultPluginsDeps {
  /** The client bound to the backend being bootstrapped. */
  readonly stigmer: Stigmer;
  /** Human progress lines (stderr). */
  readonly info: (line: string) => void;
}

export interface DefaultPluginsOptions {
  /** The org the defaults are installed into: the seedpack's org, until the seedpack is gone. */
  readonly org: string;
  /** How the official tree is found (injectable for tests). */
  readonly official?: ResolveOfficialOptions;
}

export type DefaultPluginOutcome =
  | {
      readonly name: string;
      readonly action: "installed";
      readonly digest: string;
    }
  | {
      readonly name: string;
      readonly action: "up-to-date";
      readonly digest: string;
    }
  | {
      readonly name: string;
      readonly action: "failed";
      readonly error: string;
    };

export interface DefaultPluginsResult {
  readonly outcomes: readonly DefaultPluginOutcome[];
  /** The names that did not land, for the caller's warning. */
  readonly failed: readonly string[];
}

/** Install every default the official marketplace names, in order, skipping what the backend already holds. */
export async function installDefaultPlugins(
  deps: DefaultPluginsDeps,
  options: DefaultPluginsOptions,
): Promise<DefaultPluginsResult> {
  const official = resolveOfficialMarketplace(options.official);
  const tree = readMarketplaceTree(official.dir, "the official marketplace");

  const outcomes: DefaultPluginOutcome[] = [];
  for (const name of tree.marketplace.defaults) {
    try {
      const prepared = await prepareEntry(tree, name);
      if (await isAlreadyInstalled(deps.stigmer, options.org, prepared)) {
        outcomes.push({ name, action: "up-to-date", digest: prepared.digest });
        continue;
      }
      deps.info(`Installing default plugin '${name}'…`);
      await pushPrepared(deps.stigmer, prepared, {
        org: options.org,
        visibility: ApiResourceVisibility.visibility_public,
        message: `default plugin, installed by stigmer up (${VERSION})`,
      });
      outcomes.push({ name, action: "installed", digest: prepared.digest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("default plugin install failed", { name, error: message });
      outcomes.push({ name, action: "failed", error: message });
    }
  }
  return {
    outcomes,
    failed: outcomes
      .filter((outcome) => outcome.action === "failed")
      .map((outcome) => outcome.name),
  };
}

/**
 * True when the org already holds this exact archive, materialised and
 * public. A plugin that is absent (NOT_FOUND) installs; one that is present
 * with another digest, still installing, failed, or not public is pushed
 * again, which the server treats as an upgrade or a convergence.
 */
async function isAlreadyInstalled(
  stigmer: Stigmer,
  org: string,
  prepared: PreparedPluginPush,
): Promise<boolean> {
  let existing;
  try {
    existing = await stigmer.plugin.getByReference({
      org,
      slug: prepared.plugin.name,
    });
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  return (
    existing.status?.digest === prepared.digest &&
    existing.status.state === PluginState.READY &&
    existing.metadata?.visibility === ApiResourceVisibility.visibility_public
  );
}
